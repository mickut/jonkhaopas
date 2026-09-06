import {
  PROFILES,
  type Profile,
  type ProfileLocations,
} from "../data/types.js";
import { AboutInfo } from "./AboutInfo.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import "./WeightControls.css";

const PROFILE_SWATCHES: Record<(typeof PROFILES)[number], string> = {
  work: "work-swatch",
  weekdayEvening: "evening-swatch",
  weekend: "weekend-swatch",
};

type WeightControlsProps = {
  patience: number;
  onPatienceChange: (value: number) => void;
  locations: ProfileLocations;
  activeProfile: Profile;
  onActiveProfileChange: (profile: Profile) => void;
  onRemoveLocation: (profile: Profile, index: number) => void;
  maxLocations: number;
};

export function WeightControls({
  patience,
  onPatienceChange,
  locations,
  activeProfile,
  onActiveProfileChange,
  onRemoveLocation,
  maxLocations,
}: WeightControlsProps) {
  const { t } = useTranslation();
  const profileLabels = t.profile;
  return (
    <div className="panel weight-controls">
      <div className="weight-controls-header">
        <h2>Jonkhaopas</h2>
        <AboutInfo />
      </div>
      <div className="weight-controls-scroll">
        <p className="hint">{t.header.hint}</p>
        <div className="profile-tabs" aria-label="Destination category">
          {PROFILES.map((profile) => (
            <button
              key={profile}
              type="button"
              className={profile === activeProfile ? "active" : ""}
              onClick={() => onActiveProfileChange(profile)}
            >
              <span className="profile-name">
                <span
                  className={`location-swatch ${PROFILE_SWATCHES[profile]}`}
                  aria-hidden="true"
                />
                {profileLabels[profile]}
              </span>
              <span>{locations[profile].length}</span>
            </button>
          ))}
        </div>
        <p className="category-limit">
          {t.weightControls.categoryLimit(
            locations[activeProfile].length,
            maxLocations,
            profileLabels[activeProfile],
          )}
        </p>
        {PROFILES.some((profile) => locations[profile].length === 0) && (
          <p className="calculation-hint">{t.weightControls.calculationHint}</p>
        )}
        <div className="location-list">
          {locations[activeProfile].map((location, index) => (
            <div key={`${activeProfile}-${index}`} className="location-row">
              <span className="location-name">
                <span
                  className={`location-swatch ${PROFILE_SWATCHES[activeProfile]}`}
                  aria-hidden="true"
                />
                {profileLabels[activeProfile]} {index + 1}
              </span>
              <button
                type="button"
                aria-label={t.weightControls.removeAria(
                  profileLabels[activeProfile],
                  index,
                )}
                onClick={() => onRemoveLocation(activeProfile, index)}
              >
                {t.weightControls.remove}
              </button>
              <span className="coordinates">
                {location.lat.toFixed(3)}, {location.lon.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <label className="weight-slider">
        <span>{t.header.patience}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={patience}
          onChange={(e) => onPatienceChange(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
