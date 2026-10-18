# 卡片焦点与脑图手写 API 核对

核对日期：2026-10-11。目标是 MN4 经典插件；用户真机版本为 MN4.5.0/60。本笔记核对最新官方场景插件文档、官方旧文档与 MarginNote 官方 Addon API 头文件，不读取 `mnutils`，不使用 MN Utils。

结论：有获取当前焦点卡片和指定焦点脑图草稿的公开 API；新场景接口还可观察焦点画布状态、读取已存内容与合成媒体。未找到公开的卡片进入焦点推送或逐笔事件；任意当前焦点卡的实时原始笔迹、独立笔迹图也没有通用读取保证。

## 最新场景插件接口

这组接口属于网页面板的 `/bridge/v1` 与 `window.mn` 体系。新站的插件清单示例写 `marginnote_version_min: "4.5.0"`，但不能据此认定所有路由在用户的 MN4.5.0/60 均可用，也不能将它们一概归为 MN5 专属。应以设备实际返回的 `GET /capabilities`、`GET /guide` 和手写能力清单确认。本项目现有经典插件的 `file:` UIWebView 未建立 `window.mn`，因此不能直接把示例 `mn.api(...)` 粘贴进现有插件调用。[事件系统与清单示例](https://mnext.museday.top/zh/events)、[能力清单](https://mnext.museday.top/api-reference/能力与状态/获取能力清单)、[手写能力清单](https://mnext.museday.top/api-reference/手写会话/获取手写能力清单)、[场景插件 SDK](https://mnext.museday.top/zh/sdk)。

| 需求 | 新场景接口 | 范围与限制 |
| --- | --- | --- |
| 获取焦点身份 | `GET /ui-state` → `state.focusnoteid` | 是查询时刻的界面状态，键会随宿主版本变化。 |
| 获取整理后的上下文 | `GET /context` → `focusedNote` | 文档 schema 明说实测为 `null`，什么情况下非空尚无依据，不能假设总能拿到卡片。 |
| 定位卡片 | `POST /notes/{noteid}/focus` | 异步切换界面与所属学习集等；文档没有说它等同双击进入焦点编辑器。 |
| 读取已存手写标记与媒体身份 | `POST /notes/batch-get` → `items[].hasInk`、`items[].parts[].contentId` | `hasInk` 表示卡上存着笔迹；二进制项包含手写、图片等，不能假设每项都是笔迹。 |
| 取得卡片媒体 | `GET /notes/{noteid}/content/{contentId}?layers=composite&maxEdge=...` | 返回媒体而非 JSON；`layers` 只列 `composite` 和 `base`，未提供 `ink-only`。 |
| 取得整卡图片 | `GET /notes/{noteid}/render` | 标题、正文、摘录图、插图与手写的整卡合成图/PDF，不是独立手写层。 |
| 观察焦点画布 | `POST /writing/context` → `surfaces[]` | `kind: focus` 的状态示例含 `loadedBinding.noteid`、`visualFocusNoteId`、`pencilCanvas`、`dirty`、`toolInUse`、`ready`；是工作面观察结果，没有原始笔画。 |
| 保存焦点笔迹 | `POST /writing/pencil-commit`，随后 `POST /writing/pencil-result` | 保存当前焦点根画布快照，是写操作；立即返回 `pending`，结果需查，不是取笔迹接口。 |
| 获取练习笔迹预览 | `POST /writing/session-preview` → `pngBase64` | 需 `runId`/`attemptId`，只覆盖已退出尝试的专用层中已保存笔迹，排除未保存画布；不是任意焦点卡实时读取。 |

焦点状态来源：[获取界面状态](https://mnext.museday.top/api-reference/界面与模板/获取界面状态)、[获取操作上下文](https://mnext.museday.top/api-reference/能力与状态/获取操作上下文)、[定位卡片](https://mnext.museday.top/api-reference/卡片与摘录/定位卡片)。已存媒体来源：[批量获取卡片](https://mnext.museday.top/api-reference/卡片与摘录/批量获取卡片)、[获取卡片媒体文件](https://mnext.museday.top/api-reference/卡片与摘录/获取卡片媒体文件)、[获取卡片渲染图](https://mnext.museday.top/api-reference/卡片与摘录/获取卡片渲染图)。画布与练习来源：[获取手写上下文](https://mnext.museday.top/api-reference/手写会话/获取手写上下文)、[保存焦点画布的笔迹](https://mnext.museday.top/api-reference/手写会话/保存焦点画布的笔迹)、[查询笔迹保存结果](https://mnext.museday.top/api-reference/手写会话/查询笔迹保存结果)、[查询作答预览](https://mnext.museday.top/api-reference/手写会话/查询作答预览)。

新站还提供 `POST /writing/focus-enter`“进入焦点卡作答”及分层练习/练习会话相关命令，属于主动转场。请求示例包含 `requestId`、`questionId`、`carrier: 'focus'`、`confirm: true`；`pending` 不代表进入完成，需查询 `POST /writing/transition-result`，结合 `settled`、`outcome`、`ready`、`canSwitch` 判断。它不是进入焦点通知，也不能与普通定位接口混为一谈；实际支持应查手写能力清单的 `focusTransition` 等子项。[进入焦点卡作答](https://mnext.museday.top/api-reference/手写会话/进入焦点卡作答)、[手写能力清单](https://mnext.museday.top/api-reference/手写会话/获取手写能力清单)。

最新事件页列出 `excerpt`、`comments`、`practice`、`synced`、`undo`、`imported`，另有卡片菜单专用 `cardCommand`，没有列焦点切换或逐笔事件。`comments` 表示批注变化；`practice` 只在由当前插件打开的作答纸关闭时触发。事件页还声明同卡同事件在 1.5 秒内会去重，因而不能拿它当逐笔监听保证。[事件系统](https://mnext.museday.top/zh/events)。

## 经典插件明确支持的公开入口

| 需求 | 公开接口 | 确认范围 |
| --- | --- | --- |
| 读取脑图当前焦点卡片 | `NotebookController.focusNote` | 返回当前焦点的 `MbBookNote`；文档允许没有焦点。 |
| 读取当前可见焦点卡片 | `NotebookController.visibleFocusNote` | 返回可见焦点的 `MbBookNote`；文档允许为空。 |
| 切换焦点 | `NotebookController.changeFocusToNote(note)` | 把焦点切换至指定笔记。 |
| 按 ID 定位卡片 | `StudyController.focusNoteInMindMapById(noteId)` | 在脑图中聚焦并高亮指定笔记。 |
| 获取指定焦点下的脑图草稿 | `Database.sharedInstance().getSketchNoteForMindMapFocusNoteId(topicid, focusNoteId)` | 返回脑图 Sketch 的 `MbBookNote`。这是与“进入卡片焦点后获取脑图书写”最直接相关的公开查询入口。 |
| 获取笔记本脑图草稿列表 | `Database.sharedInstance().getSketchNotesForMindMap(topicid)` | 返回脑图 Sketch 笔记列表。 |
| 读取绘图统计 | `MbBookNote.getStrokesCount()`、`getDrawingSize()` | 前者是笔画总数；后者是绘图媒体二进制总字节数，不能当成画布宽高。 |
| 获取媒体原始数据 | `Database.sharedInstance().getMediaByHash(hash)` | 返回 `NSData`，媒体不存在时可能为空。 |

焦点接口来源：[NotebookController 文档](https://mn-docs.museday.top/reference/marginnote/notebook-controller/)、[官方头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBNotebookController.h)。按 ID 定位来源：[StudyController 文档](https://mn-docs.museday.top/reference/marginnote/study-controller/)。Sketch 和媒体查询来源：[Database 文档](https://mn-docs.museday.top/reference/global/database/)、[MbModelTool 文档](https://mn-docs.museday.top/reference/marginnote/mb-model-tool/)、[官方数据库头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMbModelTool.h)。统计来源：[MbBookNote 文档](https://mn-docs.museday.top/reference/marginnote/mb-book-note/)、[官方笔记头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMbBookNote.h)。

## 没找到的公开能力

`MindMapView` 的脑图专属导出是 `mindmapNodes` 与 `selViewLst`；`MindMapNode` 提供关联笔记、父子节点、摘要链接和位置。核对这两类及 `NotebookController`、`JSExtension` 后，未找到专门的“卡片进入焦点”事件、每笔书写完成事件、笔迹坐标读取方法或脑图手写导出图片方法。这个结论限定于已检查的公开文档和 JSExport 头文件，不能据此断言软件内部没有这些能力。[MindMapView 文档](https://mn-docs.museday.top/reference/marginnote/mindmap-view/)、[MindMapNode 文档](https://mn-docs.museday.top/reference/marginnote/mindmap-node/)、[JSExtension 文档](https://mn-docs.museday.top/reference/marginnote/jsextension/)、[官方 MindMapView 头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMindMapView.h)、[官方 MindMapNode 头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMindMapNode.h)、[官方扩展头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBJSExtension.h)。

`JSExtension` 的窗口活跃、笔记本打开、控制器布局、工具栏状态查询等回调，各自有其他用途；公开声明没有保证它们准确对应每次卡片焦点变化。数据库变更通知也不能未经文档或真机时序验证便视为逐笔回调。

## 文档没有保证的部分

- Sketch 查询签名虽带 `focusNoteId`，但旧文档没有详述根脑图应传什么、没有草稿时的结果、查询是否会创建空草稿，以及正在书写但尚未保存的数据是否立即可读。因此不能直接宣称该查询完全无副作用或支持实时捕获。[Database 文档](https://mn-docs.museday.top/reference/global/database/)、[官方数据库头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMbModelTool.h)。
- `getMediaByHash` 只保证取得二进制媒体，不保证 JPEG/PNG、`UIImage` 可解码、PencilKit 可解析，或提供笔迹转图片流程。[Database 文档](https://mn-docs.museday.top/reference/global/database/)。
- `getStrokesCount` 与 `getDrawingSize` 只提供汇总统计，没有导出每笔内容和几何边界的保证。[MbBookNote 文档](https://mn-docs.museday.top/reference/marginnote/mb-book-note/)。
- 官方 `JSBMbBookNote.h` 未导出名为 `drawing` 的属性；不能把真机通过其他途径读到的字段等同于公开、长期稳定的 JS API。[官方笔记头文件](https://github.com/marginnoteapp/Addon/blob/9cae7421a782b68021c004919713476e4fc45309/API/JSBMbBookNote.h)。

## 本项目真机证据与下一步

本会话的 MN4.5.0/60 真机记录已从 `drawing` 字段读出 PencilKit `wrd` 媒体，常规 `UIImage` 解码失败。这是当前设备的实验结果，不是上述公开文档对格式或兼容性的承诺。本次资料核对没有重新执行真机实验。

因此公开 API 能支持“读取焦点卡片 → 查询该焦点的脑图 Sketch 笔记 → 查看绘图统计/读取媒体数据”的验证路径；“进入焦点自动触发”和“将 PencilKit 数据渲染为识别图片”仍需分别验证，不能靠焦点接口本身解决。可先用用户明确选择的焦点卡片做手动诊断，记录焦点 ID、Sketch ID、统计值和媒体类型，确认映射后再讨论自动触发实现。

本次只查文档，没有调用 MN 设备接口，也未改源码、版本号或安装包。在线官方 `master` 与本地参考克隆一致，核对提交为 `9cae7421a782b68021c004919713476e4fc45309`；头文件证明公开导出签名，不替代 MN4 真机行为验证。
