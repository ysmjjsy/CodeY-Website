# Agent Note: 忽略编辑器与临时文件

Status: implemented

## Problem

这个仓库的 `.gitignore` 只覆盖构建产物（`dist/`、`target/`、`.astro/`、`.codey-market/`）和一个秘密文件（`.env.local`）。编辑器与操作系统的临时文件完全没有规则：`.idea/`、`.vscode/`、`*.swp`、`*.log`、`*.orig`、`*.rej`、`*~`、`Thumbs.db`，甚至连 `.DS_Store` 都没有——而姊妹仓库 CodeY 一直忽略它。

目前磁盘上没有这些文件，所以没有东西被误提交。问题在于这是**必然会发生**而不是**可能发生**：任何用 IntelliJ 或 VS Code 打开过这个项目的人，下一次 `git status` 就会看到 `.idea/` 或 `.vscode/` 待提交；任何在 macOS Finder 里浏览过目录的人都会留下 `.DS_Store`。

不修的代价不对称。现在补是 8 行文本；等真的提交进去之后再清理，需要 `git rm -r --cached` 并让每个协作者处理本地已跟踪的编辑器目录。

## Decision

在 `.gitignore` 开头补一组无锚定的宽规则：

```
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo
*~
*.orig
*.rej
*.log
```

宽规则在这里是安全的，因为**没有任何已跟踪文件使用这些扩展名**——用 `git ls-files` 核实过，匹配数为 0。规则加了注释说明这一依据，以免后来者以为它是随手写的。

## Alternatives considered

- **只加 `.DS_Store`，与 CodeY 对齐即可。** 这是最小改动，也解决了最容易触发的一项（macOS 用户）。被否决是因为它只覆盖了三种编辑器里的一种场景：`.DS_Store` 来自 Finder，而 `.idea/` 和 `.vscode/` 来自 IDE。三者的触发概率没有实质差别，一次补齐比将来分三次补更省事。

- **不加规则，靠评审拦截。** 理论上可行——这些文件在 PR 里很显眼。被否决是因为它把成本转移到了每次评审，而收益只是省下 8 行配置。仓库已经在 `AGENTS.md` 里明确表达了「用机器强制的门胜于散文式约定」的立场（`check:brand`、`check:scales`、`check:styles` 都是这个思路的产物），这条改动与之一致：虽然 `.gitignore` 本身不是门禁，但它是让评审不必再操心这件事的机制。

- **加锚定的规则（`/.idea/`、`/.vscode/`）。** 更精确，能避免忽略嵌套在 `src/` 或 `content/` 下恰好同名的目录。被否决是因为这个仓库的源码树里不存在叫 `.idea` 或 `.vscode` 的目录，锚定带来的是理论上的精确性而非实际收益，而它会让规则在子目录出现同类问题时失效。`*.swp`、`*.log` 这类按扩展名的规则本来也无法锚定。

- **顺便检查并清理现有 `.gitignore` 里指向不存在路径的规则。** 无需处理：`/artifacts/`、`/qa/`、`/design-qa.md` 指向的是**已退休的视觉证据目录**，规则的作用正是防止它们回来——文件中已有的注释写明了这一点。它们「指向不存在的路径」是预期状态，不是死规则。

## Consequences

- **收益**：用 IDE 或 Finder 打开项目不再产生待提交的垃圾。这是预防性的——当前没有任何已跟踪文件受影响，`git ls-files -c -i --exclude-standard` 返回空。
- **收益**：与 CodeY 的忽略规则在编辑器/临时文件这一层对齐，两个仓库的贡献者体验一致。
- **代价**：`*.log` 是无锚定的宽规则。如果将来需要提交一个 `.log` 测试夹具，它会被静默忽略，需要用 `!` 例外或 `git add -f`。当前没有这种情况。
- **代价**：规则清单是与 CodeY 手工同步的，没有机制保证两边一致。若 CodeY 将来再加规则，这里不会自动跟随。这是可接受的，因为两个仓库的构建体系本就不同（`AGENTS.md` 明确说明除了品牌令牌契约外不共享任何东西）。

## Verification

- `git check-ignore` 逐条验证：`.idea/x`、`.vscode/settings.json`、`a.swp`、`b.log` 均被忽略。
- `git ls-files -c -i --exclude-standard` 返回空——没有已跟踪文件被新规则误伤。
- `pnpm check` 保持通过（`check:agent-notes` 的树、格式、归档三项均会校验本文件）。
