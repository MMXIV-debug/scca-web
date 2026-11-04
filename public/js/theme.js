// Factory Method: productos que comparten la operación apply().
class Theme {
  constructor(name) { this.name = name; }
  apply() {
    document.documentElement.setAttribute('data-bs-theme', this.name);
    try { localStorage.setItem('scca_theme', this.name); } catch { /* El tema funciona sin almacenamiento. */ }
  }
}
class LightTheme extends Theme { constructor() { super('light'); } }
class DarkTheme extends Theme { constructor() { super('dark'); } }

// Creator: applyTheme usa el producto devuelto por el método fábrica.
class ThemeCreator {
  createTheme() { throw new Error('Cada creador debe implementar createTheme().'); }
  applyTheme() {
    const theme = this.createTheme();
    theme.apply();
    return theme;
  }
}
// Concrete creators: cada subclase decide qué producto construir.
class LightThemeCreator extends ThemeCreator {
  createTheme() { return new LightTheme(); }
}
class DarkThemeCreator extends ThemeCreator {
  createTheme() { return new DarkTheme(); }
}
const themeCreators = { light: new LightThemeCreator(), dark: new DarkThemeCreator() };
function updateThemeButtons() {
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    const label = dark ? 'Activar modo claro' : 'Activar modo oscuro';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(dark));
    button.querySelector('i').className = dark ? 'bi bi-sun' : 'bi bi-moon-stars';
  });
}
function applyTheme(name) {
  const creator = themeCreators[name] || themeCreators.light;
  creator.applyTheme();
  updateThemeButtons();
}
let savedTheme = 'light';
try { savedTheme = localStorage.getItem('scca_theme') || 'light'; } catch { /* Usar tema claro. */ }
applyTheme(savedTheme); // Antes de pintar el contenido, para evitar destellos.
window.toggleDarkMode = () => applyTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark');
document.addEventListener('DOMContentLoaded', updateThemeButtons);
window.addEventListener('storage', event => {
  if (event.key === 'scca_theme') applyTheme(event.newValue);
});
