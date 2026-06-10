// rules.ts — 守门人的"判断力"。
//
// 设计哲学(第一版命门):宁可漏,不可烦。
// 这里只放"几乎一定该让人看一眼"的改动 —— 误报必须接近零,
// 否则 team lead 三天就把它关了(狼来了)。
// 抓得准 >> 抓得全。第一版故意只抓最让人半夜惊醒的那几类雷。
//
// 每条规则是一个纯函数:给它一个改动的文件,返回 0 或多个 Finding。
// 这是固化 know-how 的地方 —— "哪些改动是该半夜惊醒的"就是十年 DevOps 的判断。

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  kind: ChangeKind;
  /** 这个文件里新增的行(已剥离 + 前缀),用于内容级规则 */
  addedLines: string[];
  /** 这个文件里删除的行(已剥离 - 前缀) */
  removedLines: string[];
}

export type Severity = "wake-you-up" | "look-once";

export interface Finding {
  rule: string;
  severity: Severity;
  path: string;
  /** 一句话说人话:为什么这个该看一眼 */
  why: string;
  /** 可选:最该盯的那一两行证据 */
  evidence?: string;
}

// ── 敏感路径:碰了这些,几乎一定该让人确认 ───────────────────────────
// 故意保守。只列"碰到=高概率出事"的,不列"可能有关"的。
// 导出:context 子命令复用这同一张表生成"危险地图",避免危险区定义两处漂移。
export interface SensitivePathRule { test: RegExp; rule: string; why: string }
export const SENSITIVE_PATH_RULES: SensitivePathRule[] = [
  { test: /(^|\/)\.github\/workflows\//, rule: "ci-pipeline", why: "改动了 CI/CD 流水线 —— agent 动这里可能改变构建/发布/权限行为" },
  { test: /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/i, rule: "container-build", why: "改动了容器构建定义 —— 影响运行时与攻击面" },
  { test: /\.(tf|tfvars)$/, rule: "iac-terraform", why: "改动了 Terraform —— 可能动到真实云资源,apply 后不可逆" },
  { test: /(^|\/)(k8s|kubernetes|manifests|helm|charts)\//i, rule: "k8s-manifest", why: "改动了 K8s/部署清单目录 —— 影响线上拓扑、副本、资源、权限" },
  { test: /(^|\/)(\.env|\.env\.[^/]+)$/, rule: "env-file", why: "改动了环境变量文件 —— 高概率涉及配置或密钥" },
  { test: /(^|\/)(package\.json|go\.mod|Cargo\.toml|requirements\.txt|pyproject\.toml|Gemfile)$/, rule: "dependency-manifest", why: "改动了依赖清单 —— 引入了新依赖或改了版本,供应链风险" },
  { test: /(auth|permission|rbac|policy|secret|credential)/i, rule: "authz-surface", why: "路径涉及鉴权/权限/密钥 —— agent 动这里风险最高" },
];

// ── 内容级:不看路径,看改了什么 ───────────────────────────────────
function contentFindings(fc: FileChange): Finding[] {
  const out: Finding[] = [];

  // 删了测试 —— agent 让测试变绿最廉价的作弊方式就是删掉它
  const isTest = /(\.test\.|\.spec\.|_test\.|(^|\/)tests?\/|(^|\/)__tests__\/)/i.test(fc.path);
  if (isTest && (fc.kind === "deleted" || fc.removedLines.length > fc.addedLines.length + 5)) {
    out.push({
      rule: "test-deleted",
      severity: "wake-you-up",
      path: fc.path,
      why: "删除或大幅削减了测试 —— agent 可能在用'删测试'来让 CI 变绿",
    });
  }

  // 可能硬编码的密钥(粗筛,保守:要求像真 key 的长度/格式)
  const secretLike = /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i;
  for (const line of fc.addedLines) {
    if (secretLike.test(line) && !/example|placeholder|xxx|your[_-]|dummy|test/i.test(line)) {
      out.push({
        rule: "hardcoded-secret",
        severity: "wake-you-up",
        path: fc.path,
        why: "新增了疑似硬编码的密钥/令牌 —— 一旦合并入库几乎不可撤回",
        evidence: line.trim().slice(0, 120),
      });
      break; // 一个文件报一次就够,不刷屏
    }
  }

  return out;
}

export function pathFindings(fc: FileChange): Finding[] {
  const out: Finding[] = [];
  for (const r of SENSITIVE_PATH_RULES) {
    if (r.test.test(fc.path)) {
      out.push({ rule: r.rule, severity: "wake-you-up", path: fc.path, why: r.why });
      break; // 同一文件命中一条最相关的即可,避免叠加噪音
    }
  }
  return out;
}

export function runRules(changes: FileChange[]): Finding[] {
  return changes.flatMap((fc) => [...pathFindings(fc), ...contentFindings(fc)]);
}
