import {
  PROFILES,
  type Profile,
  type ProfileLocations,
} from "../data/types.js";
import { AboutInfo } from "./AboutInfo.js";
import "./WeightControls.css";

const PROFILE_LABELS: Record<(typeof PROFILES)[number], string> = {
  work: "Work spot",
  weekdayEvening: "Weekday evening stop",
  weekend: "Weekend spot",
};
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
  return (
    <div className="panel weight-controls">
      <div className="weight-controls-header">
        <h2>Jonkhaopas</h2>
        <AboutInfo />
      </div>
      <div className="weight-controls-scroll">
        <p className="hint">
          Choose a category, then click the map to add its destinations. Drag a
          pin to move it.
        </p>
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
                {PROFILE_LABELS[profile]}
              </span>
              <span>{locations[profile].length}</span>
            </button>
          ))}
        </div>
        <p className="category-limit">
          {locations[activeProfile].length}/{maxLocations}{" "}
          {PROFILE_LABELS[activeProfile].toLowerCase()} destinations
        </p>
        {PROFILES.some((profile) => locations[profile].length === 0) && (
          <p className="calculation-hint">
            Add one destination to each category to calculate the heatmap.
          </p>
        )}
        <div className="location-list">
          {locations[activeProfile].map((location, index) => (
            <div key={`${activeProfile}-${index}`} className="location-row">
              <span className="location-name">
                <span
                  className={`location-swatch ${PROFILE_SWATCHES[activeProfile]}`}
                  aria-hidden="true"
                />
                {PROFILE_LABELS[activeProfile]} {index + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove ${PROFILE_LABELS[activeProfile].toLowerCase()} ${index + 1}`}
                onClick={() => onRemoveLocation(activeProfile, index)}
              >
                Remove
              </button>
              <span className="coordinates">
                {location.lat.toFixed(3)}, {location.lon.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <label className="weight-slider">
        <span>Traveler patience</span>
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
