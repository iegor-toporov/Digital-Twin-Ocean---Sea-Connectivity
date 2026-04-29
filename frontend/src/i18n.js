export const translations = {
  it: {
    tools: {
      opendrift: 'OpenDrift',
      pmar:      'PMAR',
    },

    panel: {
      title:         'OpenDrift Simulation',
      sectionModel:  'Modello di deriva',
      sectionSeed:   'Area di seeding',
      btnCircle:     '◯ Cerchio',
      btnRect:       '▭ Rettangolo',
      hintCircle:    'Clicca per il centro, poi di nuovo per il raggio',
      hintRect:      'Clicca e trascina per disegnare',
      hintNoShape:   "Disegna un'area sulla mappa per iniziare",
      labelStart:    'Data/ora inizio',
      labelParticles:'Numero di particelle',
      labelDuration: 'Durata (ore)',
      btnRun:        '▶ Avvia simulazione',
      btnRunning:    '⏳ Simulazione in corso…',
    },

    pmar: {
      title:           'PMAR — Analisi densità',
      sectionSeed:     'Area di seeding',
      sectionPressure: 'Tipo di pressione',
      modeDrawBtn:     '✏️ Disegna',
      modeUploadBtn:   '📂 Shapefile',
      btnCircle:       '◯ Cerchio',
      btnRect:         '▭ Rettangolo',
      hintCircle:      'Clicca per il centro, poi di nuovo per il raggio',
      hintRect:        'Clicca e trascina per disegnare',
      hintNoShape:     "Disegna un'area sulla mappa per iniziare",
      uploadHint:      'Clicca per caricare un file .zip (shapefile)',
      pressures: {
        generic: 'Tracciante',
        plastic: 'Plastica',
        oil:     'Petrolio',
      },
      labelStart:    'Data inizio',
      labelDuration: 'Durata (giorni)',
      labelParticles:'Particelle',
      labelRes:      'Risoluzione griglia',
      sectionUse:    'Layer antropico',
      useSources: {
        none:      'Nessuno',
        windfarms: 'Parchi eolici',
      },
      useWindfarmsInfo:  'Pesa le particelle per i parchi eolici marini (fonte: EMODnet)',
      useWindfarmsEmpty: 'Nessun parco eolico trovato nell\'area. Prova nel Mar del Nord.',
      btnRun:        '▶ Avvia analisi PMAR',
      btnRunning:    '⏳ Analisi in corso…',
    },

    controls: {
      speed:    'vel',
      showSeed: 'Mostra area di seeding',
      hideSeed: 'Nascondi area di seeding',
      locale:   'it-IT',
    },

    pmarControls: {
      showRaster:     'Mostra heatmap',
      hideRaster:     'Nascondi heatmap',
      showSeed:       'Mostra area',
      hideSeed:       'Nascondi area',
      showWindFarms:  'Mostra parchi eolici',
      hideWindFarms:  'Nascondi parchi eolici',
    },

    status: {
      noShape:    "Disegna prima un'area di seeding sulla mappa.",
      running:    label => `Simulazione ${label}… (1-2 min)`,
      done:       (n, k) => `${n} particelle · ${k} passi`,
      httpError:  code => `Errore HTTP ${code}`,
      badResponse:'Risposta non valida dal server',
      error:      msg => `Errore: ${msg}`,
    },

    models: {
      OceanDrift: { name: 'Tracciante',  desc: 'Correnti superficiali'     },
      PlastDrift: { name: 'Plastica',    desc: 'Con wind drag e Stokes'    },
      LarvalFish: { name: 'Larve/uova', desc: 'Galleggiabilità verticale' },
      OpenOil:    { name: 'Idrocarburi', desc: 'Evaporazione ed emulsione' },
    },

    modelLabels: {
      OceanDrift: '🌊 Tracciante',
      PlastDrift: '🧴 Plastica',
      LarvalFish: '🐟 Larve',
      OpenOil:    '🛢️ Petrolio',
    },
  },

  en: {
    tools: {
      opendrift: 'OpenDrift',
      pmar:      'PMAR',
    },

    panel: {
      title:         'OpenDrift Simulation',
      sectionModel:  'Drift model',
      sectionSeed:   'Seeding area',
      btnCircle:     '◯ Circle',
      btnRect:       '▭ Rectangle',
      hintCircle:    'Click for the centre, then again for the radius',
      hintRect:      'Click and drag to draw',
      hintNoShape:   'Draw an area on the map to start',
      labelStart:    'Start date/time',
      labelParticles:'Number of particles',
      labelDuration: 'Duration (hours)',
      btnRun:        '▶ Run simulation',
      btnRunning:    '⏳ Simulation running…',
    },

    pmar: {
      title:           'PMAR — Density analysis',
      sectionSeed:     'Seeding area',
      sectionPressure: 'Pressure type',
      modeDrawBtn:     '✏️ Draw',
      modeUploadBtn:   '📂 Shapefile',
      btnCircle:       '◯ Circle',
      btnRect:         '▭ Rectangle',
      hintCircle:      'Click for the centre, then again for the radius',
      hintRect:        'Click and drag to draw',
      hintNoShape:     'Draw an area on the map to start',
      uploadHint:      'Click to upload a .zip file (shapefile)',
      pressures: {
        generic: 'Tracer',
        plastic: 'Plastic',
        oil:     'Oil',
      },
      labelStart:    'Start date',
      labelDuration: 'Duration (days)',
      labelParticles:'Particles',
      labelRes:      'Grid resolution',
      sectionUse:    'Anthropogenic layer',
      useSources: {
        none:      'None',
        windfarms: 'Wind farms',
      },
      useWindfarmsInfo:  'Weights particles by offshore wind farm presence (source: EMODnet)',
      useWindfarmsEmpty: 'No wind farms found in this area. Try the North Sea.',
      btnRun:        '▶ Run PMAR analysis',
      btnRunning:    '⏳ Analysis running…',
    },

    controls: {
      speed:    'spd',
      showSeed: 'Show seeding area',
      hideSeed: 'Hide seeding area',
      locale:   'en-GB',
    },

    pmarControls: {
      showRaster:     'Show heatmap',
      hideRaster:     'Hide heatmap',
      showSeed:       'Show area',
      hideSeed:       'Hide area',
      showWindFarms:  'Show wind farms',
      hideWindFarms:  'Hide wind farms',
    },

    status: {
      noShape:    'Draw a seeding area on the map first.',
      running:    label => `Simulation ${label}… (1-2 min)`,
      done:       (n, k) => `${n} particles · ${k} steps`,
      httpError:  code => `HTTP error ${code}`,
      badResponse:'Invalid server response',
      error:      msg => `Error: ${msg}`,
    },

    models: {
      OceanDrift: { name: 'Tracer',       desc: 'Surface currents'      },
      PlastDrift: { name: 'Plastic',      desc: 'Wind drag & Stokes'    },
      LarvalFish: { name: 'Larvae/eggs',  desc: 'Vertical buoyancy'     },
      OpenOil:    { name: 'Hydrocarbons', desc: 'Evaporation & emulsion'},
    },

    modelLabels: {
      OceanDrift: '🌊 Tracer',
      PlastDrift: '🧴 Plastic',
      LarvalFish: '🐟 Larvae',
      OpenOil:    '🛢️ Oil',
    },
  },
}
