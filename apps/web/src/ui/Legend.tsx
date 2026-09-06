import { useTranslation } from "../i18n/LocaleContext.js";
import "./Legend.css";

export function Legend() {
  const { t } = useTranslation();
  return (
    <div className="panel legend">
      <div className="legend-ramp" />
      <div className="legend-labels">
        <span>{t.legend.good}</span>
        <span>Jonkha</span>
      </div>
      <div className="legend-title">{t.legend.title}</div>
    </div>
  );
}
