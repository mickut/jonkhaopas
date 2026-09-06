import { useState } from "react";
import { LOCALES } from "../i18n/translations.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import "./AboutInfo.css";

export function AboutInfo() {
  const [open, setOpen] = useState(false);
  const { locale, setLocale, t } = useTranslation();

  return (
    <div className="about-info">
      <button
        type="button"
        className="about-info-toggle"
        aria-label={t.about.toggleAria}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            cx="8"
            cy="8"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <circle cx="8" cy="4.6" r="1" fill="currentColor" />
          <path
            d="M8 7.2v4.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div
          className="about-info-popover"
          role="dialog"
          aria-label={t.about.toggleAria}
        >
          <div className="about-info-locale-switch" role="group" aria-label="Language">
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                className={code === locale ? "active" : ""}
                onClick={() => setLocale(code)}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <p>
            <strong>Jonkhaopas</strong> {t.about.intro}
          </p>
          <p>{t.about.history}</p>
          <p>{t.about.dataSource}</p>
          <p>{t.about.instructions}</p>
          <p>
            {t.about.copyrightPrefix}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.about.copyrightLicenseName}
            </a>
            {t.about.copyrightSuffix}
          </p>
          <button
            type="button"
            className="about-info-close"
            onClick={() => setOpen(false)}
          >
            {t.about.close}
          </button>
        </div>
      )}
    </div>
  );
}
