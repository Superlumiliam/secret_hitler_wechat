## reference
根据任务决定读哪些文件

- `/docs/game_rules.md`:游戏规则
- `/docs/secret_hitler_prd.md`:整体产品需求
- `/docs/backend_tech_detail.md`:后端技术方案设计
- `/docs/frontend_tech_detail.md`:前端技术方案设计
- `/docs/front_back_api.md`:前后端api
- `/docs/project_state.md`:本项目开发进展
- `/docs/develop_mode.md`:开发者模式开发指南
- `reference/01-首页入口.png`:首页创建房间入口的页面参考设计图
- `reference/02-创建房间.png`:创建房间时选择对局人数的页面参考设计图
- `reference/03-房间大厅.png`:房间大厅等待游戏开始的页面参考设计图
- `reference/04-对局桌面页.png`:对局中的游戏桌面页面参考设计图
- `reference/05-对局结果页.png`:对局结束复盘游戏的页面参考设计图
- `reference/06-具备规则页.png`:对局中查看规则的页面参考设计图
- `reference/07-身份页.png`:用户查看自己身份的页面参考设计图
- `reference/08-创建用户.png`:用户创建/修改头像和用户名

## 术语映射
- 对外展示桌游名称时使用英文《secret hitler》和中文《揭秘独裁者》，不要使用中文《揭秘希特勒》或包含“希特勒”的中文项目名
- 中文文案中将“希特勒”表述为“独裁者”
- 中文文案中将“法西斯阵营”表述为“极权派阵营”；涉及身份、胜负和政策轨的中文文案也统一使用“极权派”相关表述
- 技术枚举、数据库字段、英文规则来源等已有英文标识可保留原名，例如 `hitler_check`、`fascistPolicyCount`、`Fascist`

## 行为规范
- 只有我让你生成文档时才生成文档，文档应当凝练地反应核心思想，不要做重复性长篇大论，文档总是输出文档到`/docs`目录下
- 每次修改文档后做一致性检查，确保关联文档逻辑一致
- 不要删除`docs/`和`reference/`目录下的文件
- 图像处理方面的需求，从`reference/origin_images`目录下读取图片，处理完输出到`reference/processed_images`目录下。当前有`imageMagick`工具可以用，如果有使用未安装工具的需求及时反馈，保证图片输出质量。

## 项目开发约束
- 本项目按功能/模块渐进式开发，功能/模块需遵循设计文档和页面参考设计图实现
- 前端设计页面时，参考页面设计图只用于把握视觉基调，不要求机械复刻页面元素；新增或替换的素材图片应符合暗色谍报档案 / 复古桌游桌面气质：以深黑、墨绿、暗褐为底，搭配旧纸张、皮革、木纹、金属、印章、档案袋、徽章、肖像卡、桌面灯影等材质；强调铜金描边、磨损颗粒、低饱和红蓝阵营对比和少量青蓝色发光操作焦点；避免明亮卡通、现代扁平插画、通用商务插图、塑料感 3D 和与时代氛围不符的素材。
- 前端设计页面时，优先使用图片素材而非通过css代码实现

## 微信开发经验
- 本项目是微信小程序，开发时需遵循[微信小程序开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/)和[小程序优化指南](https://developers.weixin.qq.com/community/develop/doc/00040e5a0846706e893dcc24256009)
- 前端图片资源遵循小程序包体优化：大于`200K`的图片不要放进`frontend/`主包，应上传到微信云存储，通过`wx.cloud.getTempFileURL`转换为临时 HTTPS 地址后给`image.src`使用；云存储图片的源文件需在`reference/processed_images`目录保留一份备份
- 微信小程序 `image` 组件的 `webp` 属性默认不解析 WebP，且 WebP 只支持网络资源；页面使用 WebP 时优先上传到微信云存储，通过 `wx.cloud.getTempFileURL` 获取临时 HTTPS 地址，并在 `image` 上显式设置 `webp="{{true}}"`。不要在 WXSS `background-image` 或本地主包路径中直接依赖 WebP 渲染。
- 云存储图片也要控制移动端加载成本。处理大型 PNG 背景图时，优先在不缩小尺寸的前提下尝试 WebP 有损压缩并移除元数据
- 当无法使用微信开发者 CLI 做小程序页面验证时，优先用 Computer Use 查看已打开的微信开发者工具右侧模拟器并进行交互验证；例如可在首页模拟器中点击“创建房间”，再通过画面内容和底部页面路径确认是否进入`pages/create-room/index`。
- 使用微信 CLI 部署云函数时，不要依赖当前目录自动识别项目。优先使用显式路径命令：`wechat-cli cloud functions deploy --env <envId> --paths <云函数目录绝对路径> --appid <appid> --remote-npm-install`。如果使用 `--names`，必须同时传 `--project <项目绝对路径>`。出现`缺失参数 'project / appid'`说明缺少显式项目或 appid；出现`getCloudAPISignedHeader failed`可改用`--paths + --appid`重试；出现`当前函数处于Updating状态`说明云端函数正在更新，等待函数状态回到`Active`后单独重试，避免并发部署同一函数。
- 云函数内做数据库集合等资源初始化时，必须把“资源已存在”作为可忽略的成功态处理，并兼容微信云开发不同错误形态，例如`errCode === -501001`、`ResourceExist`、`Table exist`、`DATABASE_COLLECTION_ALREADY_EXIST`；不要只匹配单一英文文案，否则已有集合会被误判为`INTERNAL_ERROR`。
- 数据库集合初始化只能放在项目启动 / 维护初始化链路中，例如 `maintenanceService.ensureCollectionsDaily()`；业务云函数请求路径不得用 `ensureRequiredCollections()` 或捕获 `collection not exist` 后创建集合并重试。新增集合时更新维护初始化清单并部署 / 触发初始化，缺集合应视为环境初始化问题，而不是每次请求都检查的业务逻辑。
- 创建用户、创建房间等参考图中的铜色档案风页面，中文字体优先使用宋/明体气质的系统字体栈：`"Songti SC", STSong, SimSun, serif`。需要整页统一时把`font-family`放在页面根容器上，让按钮、输入、标题、说明文字继承；局部标题只调整字重和字号，避免混用黑体破坏参考图的复古档案感。
- 微信小程序原生`button`带有默认盒模型、边距、行高和伪元素样式，容易导致图标型按钮或横向均分选项出现视觉位置偏移。仅图标点击控件优先使用可点击`view`并保留`role="button"`、`aria-label`、`bindtap`；横向均分选项也优先用`view`承载，避免为了抵消`button`默认样式写负数定位或魔法偏移。
