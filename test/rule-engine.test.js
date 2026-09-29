'use strict';

const test = require('node:test');
const assert = require('node:assert');
const M = require('../app.js');

test('FIB-4 计算：标准输入 (52,38,45,210) ≈ 1.40', () => {
  const r = M.computeFib4({ age: 52, ast: 38, alt: 45, plt: 210 });
  assert.equal(r.computed, true);
  assert.ok(Math.abs(r.value - 1.40) < 0.01);
});

test('FIB-4 计算：低风险样本', () => {
  const r = M.computeFib4({ age: 30, ast: 20, alt: 30, plt: 300 });
  assert.ok(r.value < 1.3);
});

test('FIB-4 计算：缺失血小板 → 不计算', () => {
  const r = M.computeFib4({ age: 50, ast: 38, alt: 45, plt: null });
  assert.equal(r.computed, false);
  assert.equal(r.value, null);
});

test('FIB-4 计算：ALT=0 → 除零防护', () => {
  const r = M.computeFib4({ age: 50, ast: 38, alt: 0, plt: 210 });
  assert.equal(r.computed, false);
});

test('FIB-4 计算：非数值 → 不计算', () => {
  const r = M.computeFib4({ age: 'x', ast: 38, alt: 45, plt: 210 });
  assert.equal(r.computed, false);
});

test('风险分层 <65：边界 1.3 归中风险', () => {
  assert.equal(M.riskLevelFromFib4(1.3, 52), 'intermediate');
  assert.equal(M.riskLevelFromFib4(1.299, 52), 'low');
  assert.equal(M.riskLevelFromFib4(2.67, 52), 'intermediate');
  assert.equal(M.riskLevelFromFib4(2.671, 52), 'high');
});

test('风险分层 >=65：边界 2.0 归中风险', () => {
  assert.equal(M.riskLevelFromFib4(1.99, 70), 'low');
  assert.equal(M.riskLevelFromFib4(2.0, 70), 'intermediate');
  assert.equal(M.riskLevelFromFib4(2.5, 70), 'intermediate');
  assert.equal(M.riskLevelFromFib4(2.67, 70), 'intermediate');
  assert.equal(M.riskLevelFromFib4(2.671, 70), 'high');
});

test('年龄=65 归入 >=65 分层（1.5 → low）', () => {
  assert.equal(M.riskLevelFromFib4(1.5, 65), 'low');
  assert.equal(M.riskLevelFromFib4(2.5, 65), 'intermediate');
});

test('LSM 分层：边界 8 / 12', () => {
  assert.equal(M.evaluateLsm(7.99).level, 'low');
  assert.equal(M.evaluateLsm(8).level, 'intermediate');
  assert.equal(M.evaluateLsm(12).level, 'intermediate');
  assert.equal(M.evaluateLsm(12.01).level, 'high');
  assert.equal(M.evaluateLsm(20).level, 'high');
});

test('LSM 空值 / 负值 → null', () => {
  assert.equal(M.evaluateLsm(null), null);
  assert.equal(M.evaluateLsm(''), null);
  assert.equal(M.evaluateLsm(-5), null);
});

test('超声：疑似肝硬化 → alert', () => {
  const u = M.evaluateUltrasound('cirrhosis');
  assert.equal(u.alert, true);
  assert.ok(/肝硬化/.test(u.prompt));
});

test('超声：肝脏占位 → alert', () => {
  const u = M.evaluateUltrasound('mass');
  assert.equal(u.alert, true);
  assert.ok(/占位/.test(u.prompt));
});

test('超声：脂肪肝 → 无 alert', () => {
  assert.equal(M.evaluateUltrasound('steatosis').alert, false);
});

test('转诊聚合：超声占位触发', () => {
  const r = M.assess({ age: 52, alt: 45, ast: 38, plt: 210, ultrasound: 'mass' });
  assert.equal(r.referral.triggered, true);
  assert.ok(r.referral.reasons.indexOf('腹部超声提示肝脏占位') >= 0);
});

test('转诊聚合：FIB-4 高风险触发', () => {
  const r = M.assess({ age: 70, ast: 120, alt: 20, plt: 80, ultrasound: 'steatosis' });
  assert.equal(r.riskLevel, 'high');
  assert.equal(r.referral.triggered, true);
  assert.ok(r.referral.reasons.indexOf('FIB-4 处于高风险参考区间') >= 0);
});

test('转诊聚合：LSM 高风险触发', () => {
  const r = M.assess({ age: 52, alt: 45, ast: 38, plt: 210, ultrasound: 'steatosis', lsm: 22 });
  assert.equal(r.referral.triggered, true);
  assert.ok(r.referral.reasons.indexOf('LSM 提示进展期肝纤维化风险，需进一步专科评估') >= 0);
});

test('转诊聚合：重点异常（黄疸）触发', () => {
  const r = M.assess({ age: 52, alt: 45, ast: 38, plt: 210, ultrasound: 'steatosis', redFlags: ['jaundice'] });
  assert.equal(r.referral.triggered, true);
  assert.ok(r.referral.reasons.indexOf('存在黄疸') >= 0);
});

test('无触发：低风险且无异常', () => {
  const r = M.assess({ age: 30, alt: 30, ast: 20, plt: 300, ultrasound: 'steatosis' });
  assert.equal(r.referral.triggered, false);
});

test('信息不足场景：不误判风险、不误触发转诊', () => {
  const r = M.assess({ age: 50, alt: 45, ast: 38, plt: null, ultrasound: 'steatosis' });
  assert.equal(r.fib4Computed, false);
  assert.equal(r.riskLevel, null);
  assert.equal(r.referral.triggered, false);
  assert.equal(r.nextStep.key, 'insufficient');
});

test('患者说明：高风险模板不含「确诊」等越界表述', () => {
  const r = M.assess({ age: 70, ast: 120, alt: 20, plt: 80, ultrasound: 'steatosis' });
  assert.ok(r.patientExplanation.indexOf('进一步评估') >= 0);
  assert.ok(r.patientExplanation.indexOf('确诊') < 0);
  assert.ok(r.patientExplanation.indexOf('一定') < 0);
});

test('assess 输出含指南依据与年龄分组', () => {
  const r = M.assess({ age: 52, alt: 45, ast: 38, plt: 210, ultrasound: 'steatosis' });
  assert.equal(r.guideline.year, 2025);
  assert.equal(r.ageGroup, '<65');
});

test('校验：年龄越界报错', () => {
  const v = M.validateInput({ age: 200, alt: 45, ast: 38, plt: 210 });
  assert.ok(v.errors.length > 0);
});

test('校验：非法枚举被过滤', () => {
  const v = M.validateInput({ age: 52, gender: 'alien', comorbidities: ['x', 'diabetes'], ultrasound: 'nope', redFlags: ['q'] });
  assert.equal(v.data.gender, null);
  assert.deepEqual(v.data.comorbidities, ['diabetes']);
  assert.equal(v.data.ultrasound, 'not_done');
  assert.deepEqual(v.data.redFlags, []);
});

test('校验：实验室缺失 → 引擎判信息不足（不崩溃）', () => {
  const v = M.validateInput({ age: 52, alt: '', ast: 38, plt: 210 });
  const r = M.assess(Object.assign({ gender: 'male', ultrasound: 'steatosis' }, v.data));
  assert.equal(r.fib4Computed, false);
  assert.equal(r.riskLevel, null);
});
