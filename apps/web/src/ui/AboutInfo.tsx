import { useState } from "react";
import "./AboutInfo.css";

export function AboutInfo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="about-info">
      <button
        type="button"
        className="about-info-toggle"
        aria-label="About Jonkhaopas"
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
          aria-label="About Jonkhaopas"
        >
          <p>
            <strong>Jonkhaopas</strong> ("Middle-of-nowhere guide") is a
            tongue-in-cheek take on Helsingin seudun liikenne's official journey
            planner, "Reittiopas".
          </p>
          <p>
            The original version was developed in 2002-2003 by the author while
            figuring out where to live next, (mis)using YTV's (HSL's
            predecessor) REST API to calculate travel times.
          </p>
          <p>
            This version instead uses HSL's Open Data GTFS feed, pre-processed
            offline so the map stays responsive.
          </p>
          <p>
            Pick at least one spot each for work, evenings, and weekend targets,
            and the map scores every location by how well public transport
            serves your needs.
          </p>
          <button
            type="button"
            className="about-info-close"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
