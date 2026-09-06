import { HelsinkiMap } from "./map/HelsinkiMap";
import { LocaleProvider } from "./i18n/LocaleContext.js";

function App() {
  return (
    <LocaleProvider>
      <div className="app-shell">
        <HelsinkiMap />
      </div>
    </LocaleProvider>
  );
}

export default App;
