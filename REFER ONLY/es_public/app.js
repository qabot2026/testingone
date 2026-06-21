(function () {
  const messenger = document.getElementById('df-messenger');
  const openButtons = [
    document.getElementById('open-chat'),
    document.getElementById('start-chat'),
  ].filter(Boolean);

  function openChat() {
    if (!messenger) return;
    messenger.setAttribute('expand', 'true');
    messenger.removeAttribute('wait-open');
  }

  openButtons.forEach((btn) => {
    btn.addEventListener('click', openChat);
  });
})();
