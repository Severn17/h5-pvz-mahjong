// 将 1000x700 的游戏场景等比缩放铺满窗口
(function () {
  const SW = 1000, SH = 700
  window.gameScale = 1
  function fit () {
    const s = Math.min(window.innerWidth / SW, window.innerHeight / SH),
          ox = (window.innerWidth - SW * s) / 2,
          oy = (window.innerHeight - SH * s) / 2
    window.gameScale = s
    document.body.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + s + ')'
  }
  window.addEventListener('resize', fit)
  document.addEventListener('DOMContentLoaded', fit)
})()
