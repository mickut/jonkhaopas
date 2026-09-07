export type Locale = "en" | "fi";
export const LOCALES: Locale[] = ["en", "fi"];
export const DEFAULT_LOCALE: Locale = "en";

export type Translations = {
  header: {
    hint: string;
    inspectHint: string;
    inspectMode: string;
    patience: string;
  };
  profile: { work: string; weekdayEvening: string; weekend: string };
  weightControls: {
    categoryLimit: (count: number, max: number, profileLabel: string) => string;
    calculationHint: string;
    removeAria: (profileLabel: string, index: number) => string;
    remove: string;
  };
  about: {
    toggleAria: string;
    intro: string;
    history: string;
    dataSource: string;
    instructions: string;
    copyrightPrefix: string;
    copyrightLicenseName: string;
    copyrightSuffix: string;
    close: string;
  };
  legend: { good: string; title: string };
};

export const TRANSLATIONS: Record<Locale, Translations> = {
  en: {
    header: {
      hint: "Choose a category, then click the map to add its destinations. Drag a pin to move it.",
      inspectHint: "Tap the map to inspect a score. Select a category to add a destination.",
      inspectMode: "Inspect score",
      patience: "Traveler patience",
    },
    profile: {
      work: "Work",
      weekdayEvening: "Evening",
      weekend: "Weekend",
    },
    weightControls: {
      categoryLimit: (count, max, profileLabel) =>
        `${count}/${max} ${profileLabel.toLowerCase()} destinations`,
      calculationHint:
        "Add one destination to each category to calculate the heatmap.",
      removeAria: (profileLabel, index) =>
        `Remove ${profileLabel.toLowerCase()} ${index + 1}`,
      remove: "Remove",
    },
    about: {
      toggleAria: "About Jonkhaopas",
      intro:
        '("Middle-of-nowhere guide") is a tongue-in-cheek take on Helsingin seudun liikenne\'s official journey planner, "Reittiopas".',
      history:
        "The original version was developed in the early-to-mid 2000s (2002-2006) by the author while figuring out where to live next, (mis)using YTV's (HSL's predecessor) REST API to calculate travel times.",
      dataSource:
        "This version instead uses HSL's Open Data GTFS feed, pre-processed offline so the map stays responsive.",
      instructions:
        "Pick at least one spot each for work, evenings, and weekend targets, and the map scores every location by how well public transport serves your needs.",
      copyrightPrefix: "© 2026 Antti Kuntsi. Code and this app are licensed under ",
      copyrightLicenseName: "CC BY 4.0",
      copyrightSuffix: ".",
      close: "Close",
    },
    legend: { good: "Good", title: "Jonkhakerroin" },
  },
  fi: {
    header: {
      hint: "Valitse kategoria ja lisää sen kohteita napauttamalla karttaa. Siirrä nastaa vetämällä.",
      inspectHint: "Napauta karttaa nähdäksesi pistemäärän. Valitse kategoria lisätäksesi kohteen.",
      inspectMode: "Pistemäärän tarkistus",
      patience: "Matkustajan kärsivällisyys",
    },
    profile: {
      work: "Työpaikka",
      weekdayEvening: "Arki-ilta",
      weekend: "Viikonloppu",
    },
    weightControls: {
      categoryLimit: (count, max, profileLabel) =>
        `${count}/${max} kohdetta (${profileLabel})`,
      calculationHint:
        "Lisää yksi kohde jokaiseen kategoriaan laskeaksesi lämpökartan.",
      removeAria: (profileLabel, index) => `Poista ${profileLabel} ${index + 1}`,
      remove: "Poista",
    },
    about: {
      toggleAria: "Tietoa Jonkhaoppaasta",
      intro:
        'on humoristinen versio Helsingin seudun liikenteen (HSL) virallisesta reittioppaasta, "Reittiopas".',
      history:
        "Alkuperäinen versio kehitettiin 2000-luvun alkupuolella (2002-2006), kun tekijä pohti mihin muuttaisi seuraavaksi ja (väärin)käytti YTV:n (HSL:n edeltäjän) REST-rajapintaa matka-aikojen laskemiseen.",
      dataSource:
        "Tämä versio käyttää sen sijaan HSL:n avoimen datan GTFS-aineistoa, joka esikäsitellään etukäteen, jotta kartta pysyy responsiivisena.",
      instructions:
        "Valitse vähintään yksi kohde työlle, ilta-ajalle ja viikonlopulle — kartta pisteyttää jokaisen sijainnin sen mukaan, kuinka hyvin joukkoliikenne palvelee tarpeitasi.",
      copyrightPrefix: "© 2026 Antti Kuntsi. Koodi ja tämä sovellus on lisensoitu ",
      copyrightLicenseName: "CC BY 4.0",
      copyrightSuffix: " -lisenssillä.",
      close: "Sulje",
    },
    legend: { good: "Hyvä", title: "Jonkhakerroin" },
  },
};
