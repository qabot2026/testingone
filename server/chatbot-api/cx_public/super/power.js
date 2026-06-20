(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('super/power.html')) return;

  function init() {
    var bid = nav.getBid();
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid;
      }) || nav.BOTS[0];

    nav.mount({
      active: 'power',
      title: 'Power',
      subtitle: bot.name + ' (Bot ID ' + bot.id + ')',
      bid: bid,
    });
  }

  nav.whenReady(init);
})();
