// public/login/login.js
const $ = (q, ctx = document) => ctx.querySelector(q);

const form = $("#loginForm");
const btn = $("#submitBtn");
const toast = $("#toast");
const usernameEl = $("#username");
const passwordEl = $("#password");
const togglePass = $("#togglePass");

function notify(msg) {
  if (!toast) {
    alert(msg);
    return;
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(notify._t);
  notify._t = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setLoading(loading) {
  if (!btn) return;
  btn.toggleAttribute("disabled", !!loading);
  btn.classList.toggle("loading", !!loading);
}

if (togglePass && passwordEl) {
  togglePass.addEventListener("click", () => {
    const isPassword = passwordEl.getAttribute("type") === "password";
    passwordEl.setAttribute("type", isPassword ? "text" : "password");
    togglePass.classList.toggle("active", isPassword);
    togglePass.setAttribute(
      "aria-label",
      isPassword ? "Ocultar contraseña" : "Mostrar contraseña"
    );
  });
}

function showErrorFor(el, msg) {
  const id = el?.id;
  if (!id) return;
  const err = document.querySelector(`[data-error-for="${id}"]`);
  if (err) err.textContent = msg || "";
}

function validate() {
  let ok = true;

  if (!usernameEl.value.trim() || usernameEl.value.trim().length < 3) {
    showErrorFor(usernameEl, "Ingresa un usuario válido.");
    ok = false;
  } else {
    showErrorFor(usernameEl, "");
  }

  if (!passwordEl.value || passwordEl.value.length < 3) {
    showErrorFor(passwordEl, "Ingresa tu contraseña.");
    ok = false;
  } else {
    showErrorFor(passwordEl, "");
  }

  return ok;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;

  setLoading(true);

  try {
    const resp = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameEl.value.trim(),
        password: passwordEl.value
      })
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("Login error:", data);
      notify(data.message || "No se pudo iniciar sesión");
      return;
    }

    // Compartir SID entre pestañas
    if (data.sid) localStorage.setItem("vbox_sid", data.sid);

    // Guardar JWT y user
    if (data.jwt) sessionStorage.setItem("jwt", data.jwt);
    if (data.user) sessionStorage.setItem("user", JSON.stringify(data.user));

    // === NUEVO: redirección por rol
    const role = (data?.user?.role || "").toString().trim().toLowerCase();
    const target = role === "empresa" ? "/dashboarde" : "/dashboard";
    window.location.href = target;

  } catch (err) {
    console.error("Login exception:", err);
    notify("Error de red: revisa el servidor");
  } finally {
    setLoading(false);
  }
});
