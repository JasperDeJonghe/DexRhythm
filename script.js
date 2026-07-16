const instruments = ['kick', 'snare', 'closed hi-hat', 'open hi-hat'];

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let synthEnabled = true;
let drumEnabled = true;
let pianoEnabled = true;

const octaveFrequencies = {
    1: 32.7,
    2: 65.41,
    3: 130.81,
    4: 261.63,
    5: 523.25,
    6: 1046.5,
    7: 2093.0,
};

const generateSynthNotes = () => {
    const notes = [];
    for (let octave = 3; octave <= 6; octave++) {
        const baseFreq = octaveFrequencies[octave];
        noteNames.forEach((name, index) => {
            if (octave === 6 && index > 0) return; // stop at C6
            notes.push({
                name: `${name}${octave}`,
                freq: +(baseFreq * Math.pow(2, index / 12)).toFixed(2),
            });
        });
    }
    return notes.reverse();
};

let synthNotes = generateSynthNotes();
let pianoNotes = generateSynthNotes(); // same note range as the synth grid

const STEPS = 16;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let gridEl;
let synthGridEl;
let pianoGridEl;
let synthRowsEl;
let drumRowsEl;
let pianoRowsEl;

const soundFiles = {
    0: 'sounds/bass.mp3',
    1: 'sounds/snare-drum.mp3',
    2: 'sounds/hihat.mp3',
    3: 'sounds/hihat-open.mp3',
};

const volumes = {
    0: 0.5,
    1: 0.7,
    2: 1,
    3: 1,
};

const buffers = {};

const drumMasterGain = audioCtx.createGain();
drumMasterGain.connect(audioCtx.destination);

const synthMasterGain = audioCtx.createGain();
synthMasterGain.connect(audioCtx.destination);

// Piano gets its own soft lowpass on the master bus, since a real
// piano's high harmonics roll off with the soundboard/lid rather
// than staying bright the way a synth oscillator does.
const pianoMasterGain = audioCtx.createGain();
const pianoTone = audioCtx.createBiquadFilter();
pianoTone.type = 'lowpass';
pianoTone.frequency.value = 5200;
pianoTone.Q.value = 0.3;
pianoTone.connect(audioCtx.destination);
pianoMasterGain.connect(pianoTone);

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0.0;
let timerID = null;
let highlightTimeouts = [];

const highlightStep = (stepNumber) => {
    document.querySelectorAll('.cell.playing').forEach((cell) => {
        cell.classList.remove('playing');
    });

    document.querySelectorAll(`.cell[data-step="${stepNumber}"]`).forEach((cell) => {
        cell.classList.add('playing');
    });
};

const getTempo = () => {
    return parseFloat(document.getElementById('bpm').value) || 150;
};

const scheduleAheadTime = 0.1; // sec
const lookahead = 25.0; // ms

const scheduler = () => {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        scheduleStep(currentStep, nextNoteTime);

        const secondsPerStep = 60.0 / getTempo() / 4;
        nextNoteTime += secondsPerStep;
        currentStep = (currentStep + 1) % STEPS;
    }
    timerID = setTimeout(scheduler, lookahead);
};

const scheduleStep = (stepNumber, time) => {
    // drums
    if (drumEnabled) {
        let rowIndex = 0;
        for (const row of drumRowsEl.children) {
            const cells = row.querySelectorAll('.cell');
            const cell = cells[stepNumber];
            if (cell.classList.contains('active')) {
                playSound(rowIndex, time);
            }
            rowIndex++;
        }
    }

    // synth
    if (synthEnabled) {
        let synthRowIndex = 0;
        for (const row of synthRowsEl.children) {
            const cells = row.querySelectorAll('.cell');
            const cell = cells[stepNumber];
            if (cell.classList.contains('active')) {
                playSynthNote(synthNotes[synthRowIndex].freq, time);
            }
            synthRowIndex++;
        }
    }

    // piano
    if (pianoEnabled) {
        let pianoRowIndex = 0;
        for (const row of pianoRowsEl.children) {
            const cells = row.querySelectorAll('.cell');
            const cell = cells[stepNumber];
            if (cell.classList.contains('active')) {
                playPianoNote(pianoNotes[pianoRowIndex].freq, time);
            }
            pianoRowIndex++;
        }
    }

    const delay = (time - audioCtx.currentTime) * 1000;
    const id = setTimeout(() => {
        if (isPlaying) highlightStep(stepNumber);
    }, delay);
    highlightTimeouts.push(id);
};

const play = () => {
    isPlaying = !isPlaying;

    const playButton = document.getElementById('playBtn');
    if (isPlaying) {
        playButton.textContent = '⏹';
    } else {
        playButton.textContent = '▶';
    }

    if (isPlaying) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        currentStep = 0;
        nextNoteTime = audioCtx.currentTime;
        scheduler();
    } else {
        clearTimeout(timerID);
        highlightTimeouts.forEach(clearTimeout);
        highlightTimeouts = [];

        document.querySelectorAll('.cell.playing').forEach((cel) => {
            cel.classList.remove('playing');
        });
    }
};

const loadSounds = async () => {
    for (const row in soundFiles) {
        try {
            const response = await fetch(soundFiles[row]);
            const arrayBuffer = await response.arrayBuffer();
            buffers[row] = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (err) {
            // sample assets aren't bundled in every environment
        }
    }
};

const playSound = (row, time) => {
    if (!buffers[row]) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buffers[row];

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = volumes[row] ?? 1;

    source.connect(gainNode);
    gainNode.connect(drumMasterGain);

    source.start(time || 0);
};

const playSynthNote = (freq, time, duration = 0.2) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth'; // try 'square' or 'triangle' too
    osc.frequency.value = freq;

    const gainNode = audioCtx.createGain();
    const now = time || audioCtx.currentTime;

    // simple attack/decay envelope to avoid clicks
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gainNode);
    gainNode.connect(synthMasterGain);

    osc.start(now);
    osc.stop(now + duration + 0.05);
};

// Additive piano synthesis: a stack of sine partials (the fundamental
// plus overtones) each with its own decay, since in a real piano the
// higher partials die out faster than the fundamental. A short, brighter
// "hammer strike" transient is layered on top of the attack for realism.
const pianoHarmonics = [
    { mult: 1, gain: 0.55, decayMult: 1.0 },
    { mult: 2, gain: 0.3, decayMult: 0.75 },
    { mult: 3, gain: 0.16, decayMult: 0.55 },
    { mult: 4, gain: 0.1, decayMult: 0.42 },
    { mult: 5, gain: 0.06, decayMult: 0.32 },
    { mult: 6, gain: 0.04, decayMult: 0.24 },
    { mult: 7, gain: 0.025, decayMult: 0.18 },
    { mult: 8, gain: 0.015, decayMult: 0.14 },
];

const playPianoNote = (freq, time, duration = 1.8) => {
    const now = time || audioCtx.currentTime;

    const noteBus = audioCtx.createGain();
    noteBus.gain.value = 1;
    noteBus.connect(pianoMasterGain);

    pianoHarmonics.forEach(({ mult, gain, decayMult }) => {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        // a touch of inharmonicity, like real piano strings, so upper
        // partials aren't perfectly locked to the fundamental
        osc.frequency.value = freq * mult * (1 + 0.0004 * mult * mult);

        const partialGain = audioCtx.createGain();
        const decay = Math.max(0.15, duration * decayMult);

        partialGain.gain.setValueAtTime(0, now);
        partialGain.gain.linearRampToValueAtTime(gain, now + 0.006);
        partialGain.gain.exponentialRampToValueAtTime(0.0008, now + decay);

        osc.connect(partialGain);
        partialGain.connect(noteBus);

        osc.start(now);
        osc.stop(now + decay + 0.05);
    });

    // brief filtered-noise "hammer" transient right at the attack
    const hammerBufferSize = audioCtx.sampleRate * 0.02;
    const hammerBuffer = audioCtx.createBuffer(1, hammerBufferSize, audioCtx.sampleRate);
    const hammerData = hammerBuffer.getChannelData(0);
    for (let i = 0; i < hammerBufferSize; i++) {
        hammerData[i] = (Math.random() * 2 - 1) * (1 - i / hammerBufferSize);
    }

    const hammerSource = audioCtx.createBufferSource();
    hammerSource.buffer = hammerBuffer;

    const hammerFilter = audioCtx.createBiquadFilter();
    hammerFilter.type = 'bandpass';
    hammerFilter.frequency.value = Math.min(freq * 4, 8000);
    hammerFilter.Q.value = 0.7;

    const hammerGain = audioCtx.createGain();
    hammerGain.gain.setValueAtTime(0.12, now);
    hammerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    hammerSource.connect(hammerFilter);
    hammerFilter.connect(hammerGain);
    hammerGain.connect(noteBus);

    hammerSource.start(now);
    hammerSource.stop(now + 0.03);
};

const listenToClear = () => {
    const clearButton = document.getElementById('clearBtn');
    clearButton.addEventListener('click', () => {
        const cells = document.querySelectorAll('.cell');
        cells.forEach((cell) => cell.classList.remove('active'));
    });
};

const listenToDrumToggle = () => {
    const toggle = document.getElementById('drumToggle');
    const drumSlider = document.getElementById('drumVolume');
    const channel = document.getElementById('drumChannel');

    toggle.addEventListener('change', () => {
        drumEnabled = toggle.checked;
        gridEl.style.display = drumEnabled ? '' : 'none';
        channel.classList.toggle('disabled', !drumEnabled);

        if (!drumEnabled) {
            drumMasterGain.gain.value = 0;
        } else {
            drumMasterGain.gain.value = parseFloat(drumSlider.value);
        }
    });
};

const listenToSynthToggle = () => {
    const toggle = document.getElementById('synthToggle');
    const synthSlider = document.getElementById('synthVolume');
    const channel = document.getElementById('synthChannel');

    toggle.addEventListener('change', () => {
        synthEnabled = toggle.checked;
        synthGridEl.style.display = synthEnabled ? '' : 'none';
        channel.classList.toggle('disabled', !synthEnabled);

        if (!synthEnabled) {
            synthMasterGain.gain.value = 0;
        } else {
            synthMasterGain.gain.value = parseFloat(synthSlider.value);
        }
    });
};

const listenToPianoToggle = () => {
    const toggle = document.getElementById('pianoToggle');
    const pianoSlider = document.getElementById('pianoVolume');
    const channel = document.getElementById('pianoChannel');

    toggle.addEventListener('change', () => {
        pianoEnabled = toggle.checked;
        pianoGridEl.style.display = pianoEnabled ? '' : 'none';
        channel.classList.toggle('disabled', !pianoEnabled);

        if (!pianoEnabled) {
            pianoMasterGain.gain.value = 0;
        } else {
            pianoMasterGain.gain.value = parseFloat(pianoSlider.value);
        }
    });
};

const listenToVolumeDisplays = () => {
    document.querySelectorAll('input[type="range"]').forEach((slider) => {
        const valueDisplay = document.getElementById(`${slider.id}Value`);

        if (!valueDisplay) return;

        const updateDisplay = () => {
            valueDisplay.textContent = Math.round(slider.value * 100);
        };

        slider.addEventListener('input', updateDisplay);

        updateDisplay();
    });
};

const listenToPlay = () => {
    const playButton = document.getElementById('playBtn');
    playButton.addEventListener('click', play);
};

const listenToVolumes = () => {
    const drumSlider = document.getElementById('drumVolume');
    const synthSlider = document.getElementById('synthVolume');
    const pianoSlider = document.getElementById('pianoVolume');

    drumMasterGain.gain.value = parseFloat(drumSlider.value);
    synthMasterGain.gain.value = parseFloat(synthSlider.value);
    pianoMasterGain.gain.value = parseFloat(pianoSlider.value);

    drumSlider.addEventListener('input', () => {
        drumMasterGain.gain.value = parseFloat(drumSlider.value);
    });

    synthSlider.addEventListener('input', () => {
        synthMasterGain.gain.value = parseFloat(synthSlider.value);
    });

    pianoSlider.addEventListener('input', () => {
        pianoMasterGain.gain.value = parseFloat(pianoSlider.value);
    });
};

const buildGrid = () => {
    instruments.forEach((name, rowIndex) => {
        const row = document.createElement('div');
        row.className = 'row';

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = name;
        label.style.cursor = 'pointer';
        row.appendChild(label);

        label.addEventListener('click', () => {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            playSound(rowIndex);
        });

        for (let step = 0; step < STEPS; step++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = rowIndex;
            cell.dataset.step = step;
            if (step % 4 === 0) cell.textContent = step / 4 + 1;
            row.appendChild(cell);
            cell.addEventListener('click', () => {
                cell.classList.toggle('active');
            });
        }

        drumRowsEl.appendChild(row);
    });
};

// Shared builder for note-based grids (synth / piano), since both
// use the same row/cell structure and only differ in the play function.
const buildNoteGrid = (containerEl, notes, playFn) => {
    notes.forEach((note, rowIndex) => {
        const row = document.createElement('div');
        row.className = 'row';

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = note.name;
        label.style.cursor = 'pointer';
        row.appendChild(label);

        label.addEventListener('click', () => {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            playFn(note.freq, audioCtx.currentTime);
        });

        for (let step = 0; step < STEPS; step++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = rowIndex;
            cell.dataset.step = step;
            if (step % 4 === 0) cell.textContent = step / 4 + 1;
            row.appendChild(cell);
            cell.addEventListener('click', () => {
                cell.classList.toggle('active');
            });
        }

        containerEl.appendChild(row);
    });
};

const buildSynthGrid = () => buildNoteGrid(synthRowsEl, synthNotes, playSynthNote);
const buildPianoGrid = () => buildNoteGrid(pianoRowsEl, pianoNotes, playPianoNote);

const init = () => {
    gridEl = document.getElementById('grid');
    synthGridEl = document.getElementById('synthGrid');
    pianoGridEl = document.getElementById('pianoGrid');
    drumRowsEl = document.getElementById('drumRows');
    synthRowsEl = document.getElementById('synthRows');
    pianoRowsEl = document.getElementById('pianoRows');

    document.querySelectorAll('input[type="range"]').forEach((slider) => {
        slider.style.setProperty('--accent', slider.dataset.accent);
    });

    loadSounds();
    buildGrid();
    buildSynthGrid();
    buildPianoGrid();
    listenToPlay();
    listenToClear();
    listenToVolumes();
    listenToVolumeDisplays();
    listenToSynthToggle();
    listenToDrumToggle();
    listenToPianoToggle();
};

document.addEventListener('DOMContentLoaded', init);
