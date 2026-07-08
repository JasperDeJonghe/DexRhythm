const instruments = ['kick', 'snare', 'closed hi-hat', 'open hi-hat'];

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const octaveFrequencies = {
    1: 32.7,
    2: 65.41,
    3: 130.81,
    4: 261.63,
    5: 523.25,
    6: 1046.5,
    7: 2093.0,
};

const generateSynthNotes = (octave) => {
    const baseFreq = octaveFrequencies[octave];

    return noteNames.map((name, index) => ({
        name: `${name}${octave}`,
        freq: +(baseFreq * Math.pow(2, index / 12)).toFixed(2),
    }));
};

let synthNotes = generateSynthNotes(3);

const STEPS = 16;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let gridEl;
let synthGridEl;

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

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0.0;
let timerID = null;
let highlightTimeouts = [];

const scheduleAheadTime = 0.1; // sec
const lookahead = 25.0; // ms

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

const scheduleStep = (stepNumber, time) => {
    // drums
    let rowIndex = 0;
    for (const row of gridEl.children) {
        const cells = row.querySelectorAll('.cell');
        const cell = cells[stepNumber];
        if (cell.classList.contains('active')) {
            playSound(rowIndex, time);
        }
        rowIndex++;
    }

    // synth
    let synthRowIndex = 0;
    for (const row of synthGridEl.children) {
        const cells = row.querySelectorAll('.cell');
        const cell = cells[stepNumber];
        if (cell.classList.contains('active')) {
            playSynthNote(synthNotes[synthRowIndex].freq, time);
        }
        synthRowIndex++;
    }

    const delay = (time - audioCtx.currentTime) * 1000;
    const id = setTimeout(() => {
        if (isPlaying) highlightStep(stepNumber);
    }, delay);
    highlightTimeouts.push(id);
};

const scheduler = () => {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        scheduleStep(currentStep, nextNoteTime);

        const secondsPerStep = 60.0 / getTempo() / 4;
        nextNoteTime += secondsPerStep;
        currentStep = (currentStep + 1) % STEPS;
    }
    timerID = setTimeout(scheduler, lookahead);
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
        const response = await fetch(soundFiles[row]);
        const arrayBuffer = await response.arrayBuffer();
        buffers[row] = await audioCtx.decodeAudioData(arrayBuffer);
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

const listenToClear = () => {
    const clearButton = document.getElementById('clearBtn');
    clearButton.addEventListener('click', () => {
        const cells = document.querySelectorAll('.cell');
        cells.forEach((cell) => cell.classList.remove('active'));
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

    drumMasterGain.gain.value = parseFloat(drumSlider.value);
    synthMasterGain.gain.value = parseFloat(synthSlider.value);

    drumSlider.addEventListener('input', () => {
        drumMasterGain.gain.value = parseFloat(drumSlider.value);
    });

    synthSlider.addEventListener('input', () => {
        synthMasterGain.gain.value = parseFloat(synthSlider.value);
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

        gridEl.appendChild(row);
    });
};

const buildSynthGrid = () => {
    synthNotes.forEach((note, rowIndex) => {
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
            playSynthNote(note.freq, audioCtx.currentTime);
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

        synthGridEl.appendChild(row);
    });
};

const updateSynthLabels = (octave) => {
    synthNotes = generateSynthNotes(octave);

    const labels = synthGridEl.querySelectorAll('.label');

    labels.forEach((label, index) => {
        label.textContent = synthNotes[index].name;
    });
};

const init = () => {
    gridEl = document.getElementById('grid');
    synthGridEl = document.getElementById('synthGrid');

    document.querySelectorAll('input[type="range"]').forEach((slider) => {
        slider.style.setProperty('--accent', slider.dataset.accent);
    });

    document.getElementById('octaveSelect').addEventListener('change', (e) => {
        synthNotes = generateSynthNotes(Number(e.target.value));
        updateSynthLabels(Number(e.target.value));
    });

    loadSounds();
    buildGrid();
    buildSynthGrid();
    listenToPlay();
    listenToClear();
    listenToVolumes();
    listenToVolumeDisplays();
};

document.addEventListener('DOMContentLoaded', init);
