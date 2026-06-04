/* 跟随全局主题偏好（system|light|dark），尽早执行以减少闪烁 */
(function () {
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function apply(pref) {
    var dark = pref === 'dark' || (pref === 'system' && mq.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  apply(mq.matches ? 'system' : 'system');
  try {
    chrome.storage.local.get(['theme'], function (res) {
      apply(['system', 'light', 'dark'].includes(res.theme) ? res.theme : 'system');
    });
  } catch (e) { /* ignore */ }
  mq.addEventListener('change', function () {
    try {
      chrome.storage.local.get(['theme'], function (res) {
        var pref = res.theme || 'system';
        if (pref === 'system') apply('system');
      });
    } catch (e) { /* ignore */ }
  });
})();
