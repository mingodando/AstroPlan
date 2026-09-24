// Exposes window.astroplanReady, a Promise that resolves once the user is
// confirmed signed in. app.js awaits this instead of listening for an event,
// so it works no matter which script finishes first.
window.astroplanReady = (async () => {
  const { data } = await window.sb.auth.getSession();
  const session = data && data.session;

  if (!session) {
    window.location.replace('login.html');
    return new Promise(() => {}); // never resolves — we're navigating away
  }

  window.currentUser = session.user;
  document.body.classList.remove('auth-pending');

  const emailEl = document.getElementById('userEmail');
  if (emailEl) emailEl.textContent = session.user.email;

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await window.sb.auth.signOut();
      window.location.replace('login.html');
    });
  }

  window.sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.replace('login.html');
  });

  return session.user;
})();
