/**
 * 入口：加载素材后显示标题画面
 */
const G = new Game()
UI.bind()
G.bindInput()
requestAnimationFrame(t => G.loop(t))
loadAssets(p => { $('loadFill').style.width = (p * 100) + '%' }).then(() => {
  $('loading').classList.add('hidden')
  G.state = 'title'
  UI.showTitle()
})
