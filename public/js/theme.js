// 1. Definimos las Estrategias
const LightThemeStrategy = {
  apply: () => {
    document.documentElement.setAttribute('data-bs-theme', 'light');
    localStorage.setItem('scca_theme', 'light');
  }
};

const DarkThemeStrategy = {
  apply: () => {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    localStorage.setItem('scca_theme', 'dark');
  }
};

// 2. El Contexto que usa las estrategias (y también lo hacemos Singleton)
class ThemeContext {
  constructor() {
    if (!ThemeContext.instance) {
      this.strategy = LightThemeStrategy;
      ThemeContext.instance = this;
    }
    return ThemeContext.instance;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  applyTheme() {
    this.strategy.apply();
  }

  toggle() {
    const currentTheme = localStorage.getItem('scca_theme') || 'light';
    if (currentTheme === 'light') {
      this.setStrategy(DarkThemeStrategy);
    } else {
      this.setStrategy(LightThemeStrategy);
    }
    this.applyTheme();
  }

  init() {
    const savedTheme = localStorage.getItem('scca_theme') || 'light';
    this.setStrategy(savedTheme === 'dark' ? DarkThemeStrategy : LightThemeStrategy);
    this.applyTheme();
  }
}

// Inicializamos el Singleton del tema
const themeManager = new ThemeContext();
themeManager.init();

// Exponemos la función al botón del HTML
window.toggleDarkMode = () => themeManager.toggle();