# 门诊助手 MVP（MAFLD 基层诊疗路径辅助工具）

面向基层医生的**代谢相关脂肪性肝病（MAFLD）**门诊路径辅助工具。输入患者年龄、ALT/AST/血小板、腹部超声等信息，依据《代谢相关脂肪性肝病基层诊疗与管理指南（2025年）》自动计算 FIB-4、给出风险分层、下一步路径、转诊提示与随访建议。

- **纯前端、零后端、零构建**：规则引擎在浏览器端运行（确定性纯函数），可直接托管到 GitHub Pages / 任意静态空间。
- **医疗安全边界**：FIB-4 除零/NaN 防护、年龄校正阈值、边界含等号、信息不足降级、转诊触发聚合，均有单元测试覆盖。
- **可解释**：每个结论可追溯到指南与规则版本，不依赖 AI 自主诊断。

## 目录结构

```
app.js            规则引擎 + 校验 + 浏览器端接诊记录（UMD：浏览器/Node 通用）
index.html        首页
assessment.html   患者评估页（录入 → 本地计算）
result.html       结果页（风险 / 下一步 / 转诊 / 随访 / 患者说明）
guidelines.html   循证指南与规则说明
records.html      接诊清单（localStorage 本机记录）
test/             规则引擎单元测试（node --test）
```

## 本地运行

任选其一（静态站点，无需构建）：

```bash
# 方式一：Python
python -m http.server 3000
# 浏览器打开 http://localhost:3000

# 方式二：Node（需联网安装 serve）
npm start
```

> 注意：请用 http 服务访问，不要直接双击打开 file://，否则 sessionStorage 跨页传参可能不稳定。

## 测试

```bash
npm test          # 等价于 node --test，运行 test/ 下全部用例
```

## 部署到 GitHub Pages

本仓库即为站点根目录，无需构建步骤。

### 1. 在 GitHub 新建仓库
在 https://github.com/new 创建一个仓库（例如 `mafld-assistant`），**不要**勾选自动生成 README。

### 2. 初始化并提交（若尚未）

```bash
cd mafld-assistant
git init -b main
git add .
git commit -m "feat: 门诊助手 MVP 静态站点"
```

### 3. 关联远程并推送

```bash
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

### 4. 开启 GitHub Pages
仓库页面 → **Settings** → **Pages** → Source 选择 **Deploy from a branch** → Branch 选 **main** / 目录 **/root** → **Save**。

约 1–2 分钟后访问：`https://<你的用户名>.github.io/<仓库名>/`

### 5.（可选）自定义域名
Settings → Pages → Custom domain 填入你的域名，并按提示添加 DNS 记录（CNAME）。

## 数据说明
评估记录保存在**浏览器本地（localStorage）**，不上传任何服务器，仅用于医生本机回顾；清缓存或更换设备后记录不保留。若需集中存储与审计，应另建自托管后端（MySQL + 审计日志），本 MVP 未包含。
