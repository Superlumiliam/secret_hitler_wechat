## reference
根据任务决定读哪些文件

- `/docs/game_rules.md`:游戏规则
- `/docs/secret_hitler_prd.md`:整体产品需求
- `/docs/backend_tech_detail.md`:后端技术方案设计
- `/docs/frontend_tech_detail.md`:前端技术方案设计
- `/docs/front_back_api.md`:前后端api
- `/docs/project_state.md`:本项目开发进展
- `reference/01-首页入口.png`:首页创建房间入口的页面参考设计图
- `reference/02-创建房间.png`:创建房间时选择对局人数的页面参考设计图
- `reference/03-房间大厅.png`:房间大厅等待游戏开始的页面参考设计图
- `reference/04-对局桌面页.png`:对局中的游戏桌面页面参考设计图
- `reference/05-对局结果页.png`:对局结束复盘游戏的页面参考设计图
- `reference/06-具备规则页.png`:对局中查看规则的页面参考设计图
- `reference/07-身份页.png`:用户查看自己身份的页面参考设计图

## 行为规范
- 只有我让你生成文档时才生成文档，文档应当凝练地反应核心思想，不要做重复性长篇大论，文档总是输出文档到`/docs`目录下
- 每次修改文档后做一致性检查，确保关联文档逻辑一致
- 不要删除`docs/`和`reference/`目录下的文件

## 开发约束
- 本项目是微信小程序，开发时需遵循[微信小程序开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/)和[小程序优化指南](https://developers.weixin.qq.com/community/develop/doc/00040e5a0846706e893dcc24256009)
- 本项目按功能/模块渐进式开发，功能/模块需遵循设计文档和页面参考设计图实现
- 当前端需要生成图片（如默认用户头像、背景图标）时，不要直接调用`image_gen`工具，而是先用一个占位符替代图片，然后生成图片描述提示词到`project_state.md`的`image prompt`目录下
- 前端图片资源遵循小程序包体优化：大于`200K`的图片不要放进`frontend/`主包，应上传到微信云存储，通过`wx.cloud.getTempFileURL`转换为临时 HTTPS 地址后给`image.src`使用；云存储图片的源文件需在`reference/`目录保留一份备份
- 前端设计页面时，在参考页面设计图的基础上，自行决定需要哪些页面元素
- 当无法使用微信开发者 CLI 做小程序页面验证时，优先用 Computer Use 查看已打开的微信开发者工具右侧模拟器并进行交互验证；例如可在首页模拟器中点击“创建房间”，再通过画面内容和底部页面路径确认是否进入`pages/create-room/index`。
