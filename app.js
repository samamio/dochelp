'use strict';

/**
 * 门诊助手 MVP — 规则引擎 + 校验 + 浏览器端记录（UMD：浏览器与 Node 通用）
 *
 * 纯函数、无状态、无 I/O。所有结论由「规则 + 模板」决定，不依赖 AI / 随机 / 外部服务。
 * 这是医疗安全的第一道闸：可在 Node 下完全确定性单元测试，也可直接在浏览器端运行。
 *
 * 依据：《代谢相关脂肪性肝病基层诊疗与管理指南（2025年）》
 */

var GUIDELINE = {
  name: '代谢相关脂肪性肝病基层诊疗与管理指南',
  year: 2025,
  ruleVersion: 'MAFLD-2025-BASELINE-v1',
  source: '2025 基层指南',
};

// 年龄校正阈值：65 岁及以上采用不同分层
var AGE_THRESHOLD = 65;

var RISK_LABEL = {
  low: '低风险参考区间',
  intermediate: '中风险参考区间',
  high: '高风险参考区间',
};

var RED_FLAG_LABEL = {
  jaundice: '存在黄疸',
  ascites: '存在腹水',
  other: '存在其他需要专科评估的情况',
};

var COMORBIDITY_LABEL = {
  diabetes: '糖尿病',
  obesity: '超重/肥胖',
  dyslipidemia: '血脂异常',
  hypertension: '高血压',
};

var ULTRASOUND_LABEL = {
  not_done: '未检查',
  steatosis: '脂肪肝表现',
  cirrhosis: '疑似肝硬化',
  mass: '肝脏占位',
  other: '其他/不确定',
};

function round2(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * FIB-4 = 年龄 × AST ÷ (血小板 × √ALT)
 * 边界防护：任意输入非有限数，或 ALT≤0 / AST≤0 / 血小板≤0 时，
 * 返回 { computed:false }，绝不产生 NaN / Infinity。
 */
function computeFib4(input) {
  var age = Number(input && input.age);
  var ast = Number(input && input.ast);
  var alt = Number(input && input.alt);
  var plt = Number(input && input.plt);

  if (![age, ast, alt, plt].every(Number.isFinite)) return { computed: false, value: null };
  if (age <= 0 || ast <= 0 || alt <= 0 || plt <= 0) return { computed: false, value: null };

  var val = (age * ast) / (plt * Math.sqrt(alt));
  if (!Number.isFinite(val)) return { computed: false, value: null };

  return { computed: true, value: round2(val) };
}

/**
 * 年龄校正后的 FIB-4 风险分层。
 *  <65 岁：<1.3 低 / 1.3–2.67 中 / >2.67 高
 *  ≥65 岁：<2.0 低 / 2.0–2.67 中 / >2.67 高
 * 边界：1.3 / 2.0 / 2.67 均归入「中风险」（含等号）。
 */
function riskLevelFromFib4(value, age) {
  if (value == null || !Number.isFinite(value)) return null;
  var a = Number(age);
  if (a >= AGE_THRESHOLD) {
    if (value < 2.0) return 'low';
    if (value <= 2.67) return 'intermediate';
    return 'high';
  }
  if (value < 1.3) return 'low';
  if (value <= 2.67) return 'intermediate';
  return 'high';
}

/**
 * 瞬时弹性成像 LSM 分层（仅当医生已输入时评估）。
 *  <8 kPa：未提示进展期肝纤维化
 *  8–12 kPa：提示需要进一步评估
 *  >12 kPa：提示进展期肝纤维化风险，需进一步专科评估
 */
function evaluateLsm(lsm) {
  if (lsm == null || lsm === '' || !Number.isFinite(Number(lsm))) return null;
  var v = Number(lsm);
  if (v <= 0) return null;
  var level, message;
  if (v < 8) {
    level = 'low';
    message = '当前 LSM 结果未提示进展期肝纤维化。';
  } else if (v <= 12) {
    level = 'intermediate';
    message = '当前 LSM 结果提示需要进一步评估。';
  } else {
    level = 'high';
    message = '当前 LSM 结果提示进展期肝纤维化风险，需要进一步专科评估。';
  }
  return { value: round2(v), level: level, message: message };
}

/**
 * 腹部超声规则。
 *  疑似肝硬化 / 肝脏占位 → 重点提示 + 触发专科评估
 *  脂肪肝 / 未检查 / 其他不确定 → 无特殊规则
 */
function evaluateUltrasound(us) {
  if (us === 'cirrhosis') {
    return { value: 'cirrhosis', alert: true, prompt: '腹部超声提示疑似肝硬化，建议进一步专科评估。' };
  }
  if (us === 'mass') {
    return { value: 'mass', alert: true, prompt: '腹部超声提示肝脏占位，建议进一步专科评估。' };
  }
  return { value: us || 'not_done', alert: false, prompt: null };
}

/**
 * 下一步建议（§17）。任何情况下不得写出「患者存在肝纤维化」，
 * 只能表述为「处于高风险参考区间」。
 */
function buildNextStep(riskLevel, fib4Computed) {
  if (!fib4Computed || !riskLevel) {
    return {
      key: 'insufficient',
      title: '下一步',
      paragraphs: [
        '当前信息不足，无法完成 FIB-4 风险评估。',
        '请补充 ALT、AST 和血小板结果后重新评估。',
        '在获得完整数据前，建议结合患者代谢危险因素进行基础管理并按计划随访。',
      ],
    };
  }
  if (riskLevel === 'low') {
    return {
      key: 'low',
      title: '下一步',
      paragraphs: [
        '当前 FIB-4 处于低风险参考区间。',
        '暂无因 FIB-4 触发的进一步肝纤维化评估提示。',
        '建议继续进行代谢危险因素管理，并按计划随访。',
      ],
    };
  }
  if (riskLevel === 'intermediate') {
    return {
      key: 'intermediate',
      title: '下一步',
      paragraphs: [
        '当前 FIB-4 处于中风险参考区间。',
        '建议进一步进行肝脏瞬时弹性成像评估。',
        '如医院暂无相关检查条件，可根据实际情况考虑转诊至具备相关检查条件的医疗机构。',
      ],
    };
  }
  // high
  return {
    key: 'high',
    title: '下一步',
    paragraphs: [
      '当前 FIB-4 处于高风险参考区间。',
      '建议进一步进行肝纤维化相关评估，并结合临床情况考虑专科评估。',
    ],
  };
}

/**
 * 随访建议（§21），固定医学路径，不随个体复杂化。
 */
var FOLLOW_UP = {
  management: '建议结合患者代谢危险因素进行体重、饮食、运动、血糖及血脂等管理。',
  recheck:
    '肝肾功能、空腹血糖、血脂等可每 3～6 个月评估；血常规、上腹部超声等可按 6～12 个月进行管理，并建议定期进行肝纤维化风险评估。',
};

/**
 * 患者说明（§22），按风险等级套用模板，底部统一免责声明。
 * 不使用 AI，纯模板生成。
 */
function buildPatientExplanation(riskLevel, fib4Computed) {
  var body;
  if (!fib4Computed || !riskLevel) {
    body =
      '您目前的检查结果信息尚不完整，暂时无法完成肝纤维化风险评估。建议补充相关检查后由医生进一步评估，并按照医生安排进行复查。';
  } else if (riskLevel === 'low') {
    body =
      '您目前的检查结果显示存在脂肪肝相关风险，根据目前检查结果，进展期肝纤维化风险处于较低参考范围。建议继续关注体重、饮食、运动以及血糖、血脂等指标，并按照医生安排进行复查。';
  } else if (riskLevel === 'intermediate') {
    body =
      '您目前的检查结果提示需要进一步评估肝脏纤维化情况，建议按照医生安排进行进一步检查。平时需要注意体重、饮食、运动以及血糖、血脂等代谢指标。';
  } else {
    body =
      '您目前的检查结果提示需要进一步评估肝脏纤维化情况，建议按照医生安排进一步进行相关检查或专科评估。具体情况请结合医生的临床判断。';
  }
  var footer = '以上内容仅用于健康管理沟通，不替代医生的临床诊疗意见。';
  return body + '\n' + footer;
}

/**
 * 汇总评估（核心入口）。
 */
function assess(input) {
  var i = input || {};
  var age = i.age;
  var gender = i.gender;
  var comorbidities = Array.isArray(i.comorbidities) ? i.comorbidities : [];
  var alt = i.alt;
  var ast = i.ast;
  var plt = i.plt;
  var ultrasound = i.ultrasound;
  var lsm = i.lsm;
  var redFlags = Array.isArray(i.redFlags) ? i.redFlags : [];

  var fib = computeFib4({ age: age, ast: ast, alt: alt, plt: plt });
  var riskLevel = fib.computed ? riskLevelFromFib4(fib.value, age) : null;
  var us = evaluateUltrasound(ultrasound);
  var lsmEval = lsm != null && lsm !== '' ? evaluateLsm(lsm) : null;

  // 转诊触发聚合（§20）
  var reasons = [];
  if (us.alert) {
    reasons.push(us.value === 'cirrhosis' ? '腹部超声提示疑似肝硬化' : '腹部超声提示肝脏占位');
  }
  if (fib.computed && riskLevel === 'high') {
    reasons.push('FIB-4 处于高风险参考区间');
  }
  if (lsmEval && lsmEval.level === 'high') {
    reasons.push('LSM 提示进展期肝纤维化风险，需进一步专科评估');
  }
  redFlags.forEach(function (f) {
    reasons.push(RED_FLAG_LABEL[f] || '存在其他需要专科评估的情况');
  });

  var referral = { triggered: reasons.length > 0, reasons: reasons };
  var nextStep = buildNextStep(riskLevel, fib.computed);
  var patientExplanation = buildPatientExplanation(riskLevel, fib.computed);

  return {
    id: i.id || null,
    age: age,
    fib4: fib.value,
    fib4Computed: fib.computed,
    ageGroup: Number(age) >= AGE_THRESHOLD ? '>=65' : '<65',
    riskLevel: riskLevel,
    riskLabel: riskLevel ? RISK_LABEL[riskLevel] : '无法评估（信息不足）',
    ultrasound: us,
    lsm: lsmEval,
    comorbidities: comorbidities,
    gender: gender,
    redFlags: redFlags,
    referral: referral,
    nextStep: nextStep,
    followUp: FOLLOW_UP,
    patientExplanation: patientExplanation,
    guideline: GUIDELINE,
    assessmentTime: i.assessmentTime || new Date().toISOString(),
  };
}

/* ============================ 输入校验（不可绕过的安全边界） ============================ */

var ALLOWED_COMORBIDITY = ['diabetes', 'obesity', 'dyslipidemia', 'hypertension'];
var ALLOWED_ULTRASOUND = ['not_done', 'steatosis', 'cirrhosis', 'mass', 'other'];
var ALLOWED_RED_FLAG = ['jaundice', 'ascites', 'other'];
var ALLOWED_GENDER = ['male', 'female'];

function num(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateInput(body) {
  var errors = [];
  var data = {};
  var b = body || {};

  var age = num(b.age);
  if (age == null) {
    errors.push('年龄必须为数字');
  } else if (age < 0 || age > 120) {
    errors.push('年龄应在 0–120 之间');
  } else {
    data.age = age;
  }

  data.gender = ALLOWED_GENDER.indexOf(b.gender) >= 0 ? b.gender : null;
  var com = Array.isArray(b.comorbidities) ? b.comorbidities : [];
  data.comorbidities = com.filter(function (c) { return ALLOWED_COMORBIDITY.indexOf(c) >= 0; });

  data.alt = num(b.alt);
  data.ast = num(b.ast);
  data.plt = num(b.plt);

  data.ultrasound = ALLOWED_ULTRASOUND.indexOf(b.ultrasound) >= 0 ? b.ultrasound : 'not_done';

  var lsm = num(b.lsm);
  data.lsm = lsm != null && lsm > 0 ? lsm : null;

  var rf = Array.isArray(b.redFlags) ? b.redFlags : [];
  data.redFlags = rf.filter(function (f) { return ALLOWED_RED_FLAG.indexOf(f) >= 0; });

  return { errors: errors, data: data };
}

/* ============================ 浏览器端接诊记录（localStorage 降级） ============================ */

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch (e) {
    return false;
  }
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

var RECORDS_KEY = 'mafld_records';
var MAX_RECORDS = 200;

function saveAssessment(result) {
  if (!hasLocalStorage()) return null;
  var rec = Object.assign({}, result, { id: result.id || newId() });
  var list = getRecords();
  list.unshift(rec);
  if (list.length > MAX_RECORDS) list = list.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
  } catch (e) {
    /* 配额超限时静默降级，不影响本次评估 */
  }
  return rec.id;
}

function getRecords() {
  if (!hasLocalStorage()) return [];
  try {
    var raw = localStorage.getItem(RECORDS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function deleteRecord(id) {
  if (!hasLocalStorage()) return;
  var list = getRecords().filter(function (r) { return r.id !== id; });
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
}

function clearRecords() {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(RECORDS_KEY);
}

/* ============================ UMD 导出 ============================ */

var API = {
  GUIDELINE: GUIDELINE,
  AGE_THRESHOLD: AGE_THRESHOLD,
  RISK_LABEL: RISK_LABEL,
  RED_FLAG_LABEL: RED_FLAG_LABEL,
  COMORBIDITY_LABEL: COMORBIDITY_LABEL,
  ULTRASOUND_LABEL: ULTRASOUND_LABEL,
  FOLLOW_UP: FOLLOW_UP,
  computeFib4: computeFib4,
  riskLevelFromFib4: riskLevelFromFib4,
  evaluateLsm: evaluateLsm,
  evaluateUltrasound: evaluateUltrasound,
  buildNextStep: buildNextStep,
  buildPatientExplanation: buildPatientExplanation,
  assess: assess,
  validateInput: validateInput,
  newId: newId,
  saveAssessment: saveAssessment,
  getRecords: getRecords,
  deleteRecord: deleteRecord,
  clearRecords: clearRecords,
};

if (typeof module === 'object' && module.exports) {
  module.exports = API;
} else {
  (typeof self !== 'undefined' ? self : this).MAFLD = API;
}
