// Exposes window.astroplanReady, a Promise that resolves once the user is
// confirmed signed in. app.js awaits this instead of listening for an event,
// so it works no matter which script finishes first.

// Shows a message on the loading screen with a "Try again" button.
window.astroplanFatal = (message) => {
  const text = document.getElementById('bootText');
  const retry = document.getElementById('bootRetry');
  document.body.classList.add('boot-error');
  if (text) text.textContent = message;
  if (retry) {
    retry.hidden = false;
    retry.onclick = () => window.location.reload();
  }
};

window.astroplanReady = (async () => {
  if (!window.sb) {
    window.astroplanFatal("Couldn't reach the AstroPlan servers. Check your internet connection and try again.");
    return new Promise(() => {});
  }

  let session = null;
  try {
    const { data } = await window.sb.auth.getSession();
    session = data && data.session;
  } catch (err) {
    console.error(err);
    window.astroplanFatal("Couldn't check your sign-in. Check your internet connection and try again.");
    return new Promise(() => {});
  }

  if (!session) {
    window.location.replace('login.html');
    return new Promise(() => {}); // never resolves — we're navigating away
  }

  window.currentUser = session.user;
  document.body.classList.remove('auth-pending');

  const emailEl = document.getElementById('userEmail');
  if (emailEl) {
    emailEl.textContent = session.user.email;
    emailEl.title = session.user.email;
  }

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      signOutBtn.disabled = true;
      try {
        await window.sb.auth.signOut();
      } catch (err) {
        console.error(err);
      }
      window.location.replace('login.html');
    });
  }

  window.sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.replace('login.html');
  });

  return session.user;
})();
