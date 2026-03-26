'use strict';

// ===== CONSTANTS =====
const SUITS = ['club', 'diamond', 'heart', 'spade'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};
const HAND_NAMES = [
    'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
];

const SMALL_BLIND = 25;
const BIG_BLIND   = 50;
const STARTING_CHIPS = 5000;
const NUM_PLAYERS    = 6;

// CPU action probabilities (tune here to adjust aggression)
const PROB_FOLD_PREFLOP_PLAYER = 0.30; // UTG/CO/BTN fold probability pre-flop
const PROB_FOLD_PREFLOP_SB     = 0.25; // SB fold probability pre-flop
const PROB_BET_POSTFLOP        = 0.40; // first active player bets post-flop
const PROB_FOLD_TO_BET         = 0.35; // other players fold when facing a bet

// Delay (ms) before animating the winning cards after showdown
const SHOWDOWN_ANIMATION_DELAY = 400;

// SVG data-URI for face-down card back
const CARD_BACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 70">' +
    '<rect width="50" height="70" rx="5" fill="#1a237e"/>' +
    '<rect x="2" y="2" width="46" height="66" rx="4" fill="none" stroke="#5c6bc0" stroke-width="1.5"/>' +
    '<line x1="5" y1="5" x2="45" y2="65" stroke="#3949ab" stroke-width="1" opacity="0.6"/>' +
    '<line x1="45" y1="5" x2="5" y2="65" stroke="#3949ab" stroke-width="1" opacity="0.6"/>' +
    '<text x="25" y="42" text-anchor="middle" fill="#7986cb" font-size="22" font-family="serif">♠</text>' +
    '</svg>'
);

// ===== CARD UTILITIES =====
let cardIdCounter = 0;

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank, suit, id: cardIdCounter++ });
        }
    }
    return deck;
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function cardImagePath(card) {
    return `../../images/cards/${card.rank}-${card.suit}.png`;
}

function cardAlt(card) {
    return `${RANK_NAMES[card.rank]} of ${card.suit}s`;
}

// ===== COMBINATIONS =====
function getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    return [
        ...getCombinations(rest, k - 1).map(c => [first, ...c]),
        ...getCombinations(rest, k)
    ];
}

// ===== HAND EVALUATION =====
function evaluate5CardHand(cards) {
    const ranks  = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits  = cards.map(c => c.suit);
    const isFlush = new Set(suits).size === 1;

    // Check straight (including A-low wheel 5-4-3-2-A)
    const uniq = [...new Set(ranks)].sort((a, b) => b - a);
    let straightHigh = 0;
    if (uniq.length === 5) {
        if (uniq[0] - uniq[4] === 4) {
            straightHigh = uniq[0];
        } else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
            straightHigh = 5;
        }
    }
    const isStraight = straightHigh > 0;

    // Rank frequencies
    const freq = {};
    for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
    const groups = Object.entries(freq)
        .map(([r, c]) => ({ rank: parseInt(r), count: c }))
        .sort((a, b) => b.count - a.count || b.rank - a.rank);
    const counts = groups.map(g => g.count);

    let handRank, kickers;

    if (isFlush && isStraight) {
        handRank = 8; kickers = [straightHigh];
    } else if (counts[0] === 4) {
        handRank = 7; kickers = groups.map(g => g.rank);
    } else if (counts[0] === 3 && counts[1] === 2) {
        handRank = 6; kickers = groups.map(g => g.rank);
    } else if (isFlush) {
        handRank = 5; kickers = ranks;
    } else if (isStraight) {
        handRank = 4; kickers = [straightHigh];
    } else if (counts[0] === 3) {
        handRank = 3; kickers = groups.map(g => g.rank);
    } else if (counts[0] === 2 && counts[1] === 2) {
        handRank = 2;
        const pairs  = groups.filter(g => g.count === 2).map(g => g.rank).sort((a, b) => b - a);
        const kicker = groups.find(g => g.count === 1);
        kickers = [...pairs, kicker ? kicker.rank : 0];
    } else if (counts[0] === 2) {
        handRank = 1; kickers = groups.map(g => g.rank);
    } else {
        handRank = 0; kickers = ranks;
    }

    // Numeric score for comparison using base-15 positional encoding.
    // Base 15 is chosen because card ranks go up to 14 (Ace), so each
    // tiebreaker digit fits in [0,14]. Five digits cover all tiebreakers.
    let score = handRank * Math.pow(15, 5);
    for (let i = 0; i < 5; i++) {
        score += (kickers[i] || 0) * Math.pow(15, 4 - i);
    }
    return { handRank, score, handName: HAND_NAMES[handRank] };
}

/** Find the best 5-card hand out of allCards (2–7 cards). */
function findBestHand(allCards) {
    if (allCards.length < 5) return null;
    let best = null;
    for (const combo of getCombinations(allCards, 5)) {
        const result = evaluate5CardHand(combo);
        if (!best || result.score > best.score) {
            best = { ...result, bestCards: combo };
        }
    }
    return best;
}

// ===== GAME STATE =====
const gameState = {
    deck:          [],
    communityCards: [],
    pot:           0,
    stage:         'new', // new | preflop | flop | turn | river | showdown
    dealerPos:     0,
    handNumber:    0
};

const PLAYER_NAMES   = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];
const PLAYER_AVATARS = ['man1', 'man2', 'man3', 'man4', 'man1', 'man2'];

const players = [];

function initPlayers() {
    players.length = 0;
    for (let i = 0; i < NUM_PLAYERS; i++) {
        players.push({
            id:       i,
            name:     PLAYER_NAMES[i],
            avatar:   PLAYER_AVATARS[i],
            chips:    STARTING_CHIPS,
            cards:    [],
            bet:      0,
            action:   null,
            isSB:     false,
            isBB:     false,
            isDealer: false,
            isFolded: false,
            isWinner: false,
            handResult: null
        });
    }
}

// ===== GAME LOGIC =====

function newHand() {
    gameState.deck           = shuffle(createDeck());
    gameState.communityCards = [];
    gameState.pot            = 0;
    gameState.stage          = 'preflop';
    gameState.handNumber++;
    gameState.dealerPos      = (gameState.dealerPos + 1) % NUM_PLAYERS;

    for (const p of players) {
        p.cards      = [];
        p.bet        = 0;
        p.action     = null;
        p.isSB       = false;
        p.isBB       = false;
        p.isDealer   = false;
        p.isFolded   = false;
        p.isWinner   = false;
        p.handResult = null;
    }

    // Assign dealer, SB, BB
    const dealer = players[gameState.dealerPos];
    const sbIdx  = (gameState.dealerPos + 1) % NUM_PLAYERS;
    const bbIdx  = (gameState.dealerPos + 2) % NUM_PLAYERS;
    dealer.isDealer      = true;
    players[sbIdx].isSB  = true;
    players[bbIdx].isBB  = true;

    // Post blinds
    players[sbIdx].chips -= SMALL_BLIND;
    players[sbIdx].bet    = SMALL_BLIND;
    players[bbIdx].chips -= BIG_BLIND;
    players[bbIdx].bet    = BIG_BLIND;
    gameState.pot = SMALL_BLIND + BIG_BLIND;

    // Deal 2 hole cards to each player
    for (const p of players) {
        p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    }

    simulatePreFlopActions();
    render();
    updateButtons();
    const active = players.filter(p => !p.isFolded).length;
    setStatus(`Hand #${gameState.handNumber} — Pre-flop · ${active} players active · Pot $${gameState.pot.toLocaleString()}`);
}

function simulatePreFlopActions() {
    const sbIdx = (gameState.dealerPos + 1) % NUM_PLAYERS;
    const bbIdx = (gameState.dealerPos + 2) % NUM_PLAYERS;
    const utg   = (gameState.dealerPos + 3) % NUM_PLAYERS;

    // UTG through CO act first (all positions before SB)
    for (let i = 0; i < NUM_PLAYERS - 2; i++) {
        const p = players[(utg + i) % NUM_PLAYERS];
        if (Math.random() < PROB_FOLD_PREFLOP_PLAYER) {
            p.isFolded = true;
            p.action   = 'FOLD';
        } else {
            p.chips -= BIG_BLIND;
            p.bet    = BIG_BLIND;
            p.action = 'CALL';
            gameState.pot += BIG_BLIND;
        }
    }

    // SB acts (already posted small blind)
    const sb = players[sbIdx];
    if (Math.random() < PROB_FOLD_PREFLOP_SB) {
        sb.isFolded = true;
        sb.action   = 'FOLD';
    } else {
        const extra = BIG_BLIND - SMALL_BLIND;
        sb.chips -= extra;
        sb.bet    = BIG_BLIND;
        sb.action = 'CALL';
        gameState.pot += extra;
    }

    // BB checks (option)
    const bb = players[bbIdx];
    if (!bb.isFolded) bb.action = 'CHECK';

    // Reset per-street bets
    for (const p of players) p.bet = 0;
}

function simulateBettingRound() {
    const active = players.filter(p => !p.isFolded);
    if (active.length <= 1) return;

    let betAmount = 0;

    // First active player may bet
    if (Math.random() < PROB_BET_POSTFLOP) {
        betAmount = BIG_BLIND * 2;
        active[0].chips -= betAmount;
        active[0].bet    = betAmount;
        active[0].action = 'BET';
        gameState.pot += betAmount;
    } else {
        active[0].action = 'CHECK';
    }

    // Remaining active players respond
    for (let i = 1; i < active.length; i++) {
        const p = active[i];
        if (betAmount > 0) {
            if (Math.random() < PROB_FOLD_TO_BET) {
                p.isFolded = true;
                p.action   = 'FOLD';
            } else {
                p.chips -= betAmount;
                p.bet    = betAmount;
                p.action = 'CALL';
                gameState.pot += betAmount;
            }
        } else {
            p.action = 'CHECK';
        }
    }

    for (const p of players) p.bet = 0;
}

function dealFlop() {
    if (gameState.stage !== 'preflop') return;
    gameState.deck.pop(); // burn
    gameState.communityCards.push(gameState.deck.pop());
    gameState.communityCards.push(gameState.deck.pop());
    gameState.communityCards.push(gameState.deck.pop());
    gameState.stage = 'flop';
    simulateBettingRound();
    render();
    updateButtons();
    setStatus(`Flop dealt · ${activePlayers()} players active · Pot $${gameState.pot.toLocaleString()}`);
}

function dealTurn() {
    if (gameState.stage !== 'flop') return;
    gameState.deck.pop();
    gameState.communityCards.push(gameState.deck.pop());
    gameState.stage = 'turn';
    simulateBettingRound();
    render();
    updateButtons();
    setStatus(`Turn dealt · ${activePlayers()} players active · Pot $${gameState.pot.toLocaleString()}`);
}

function dealRiver() {
    if (gameState.stage !== 'turn') return;
    gameState.deck.pop();
    gameState.communityCards.push(gameState.deck.pop());
    gameState.stage = 'river';
    simulateBettingRound();
    render();
    updateButtons();
    setStatus(`River dealt · ${activePlayers()} players active · Pot $${gameState.pot.toLocaleString()}`);
}

/** Deal any remaining community cards without betting ("run it out"). */
function runItOut() {
    const cc = gameState.communityCards;

    // Flop (3 cards)
    if (cc.length < 3) {
        gameState.deck.pop();
        while (cc.length < 3) cc.push(gameState.deck.pop());
    }
    // Turn
    if (cc.length < 4) {
        gameState.deck.pop();
        cc.push(gameState.deck.pop());
    }
    // River
    if (cc.length < 5) {
        gameState.deck.pop();
        cc.push(gameState.deck.pop());
    }

    gameState.stage = 'river';
    document.getElementById('btn-run-it-out').style.display = 'none';
    render();
    updateButtons();
    setStatus('Running it out — all community cards dealt! Click "Showdown" to reveal the winner.');
}

function showdown() {
    if (gameState.stage !== 'river') return;
    gameState.stage = 'showdown';

    const active = players.filter(p => !p.isFolded);

    // Evaluate each active player's best hand
    for (const p of active) {
        p.handResult = findBestHand([...p.cards, ...gameState.communityCards]);
    }

    // Find highest score
    const maxScore = Math.max(...active.map(p => (p.handResult ? p.handResult.score : 0)));
    const winners  = active.filter(p => p.handResult && p.handResult.score === maxScore);

    // Award pot (split if tie)
    const share = Math.floor(gameState.pot / winners.length);
    for (const w of winners) {
        w.chips   += share;
        w.isWinner = true;
    }

    render();
    updateButtons();

    // Animate winning cards after a short delay
    setTimeout(() => winners.forEach(animateWinningCards), SHOWDOWN_ANIMATION_DELAY);

    const names    = winners.map(w => w.name).join(' & ');
    const handName = winners[0].handResult ? winners[0].handResult.handName : '—';
    setStatus(`🏆 ${names} wins with ${handName}! Pot $${gameState.pot.toLocaleString()}`);
}

/** Highlight the 5 cards that form the winner's best hand. */
function animateWinningCards(player) {
    if (!player.handResult || !player.handResult.bestCards) return;
    const bestIds = new Set(player.handResult.bestCards.map(c => c.id));

    const seatEl = document.getElementById(`seat-${player.id}`);
    if (!seatEl) return;

    // Hole cards
    player.cards.forEach((card, i) => {
        const el = seatEl.querySelectorAll('.hole-card')[i];
        if (el && bestIds.has(card.id)) el.classList.add('winning-card');
    });

    // Community cards
    gameState.communityCards.forEach((card, i) => {
        const el = document.querySelectorAll('.community-card-img')[i];
        if (el && bestIds.has(card.id)) el.classList.add('winning-card');
    });

    seatEl.classList.add('winner-seat');
}

// ===== HELPERS =====

function activePlayers() {
    return players.filter(p => !p.isFolded).length;
}

// ===== RENDERING =====

function render() {
    renderCommunityCards();
    renderPlayers();
    renderPot();
    document.getElementById('hand-number').textContent = `Hand #${gameState.handNumber}`;
}

function renderCommunityCards() {
    const STAGE_LABELS = ['FLOP', '', '', 'TURN', 'RIVER'];
    const stageText = { preflop: 'PRE-FLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN', new: '' };

    document.getElementById('stage-label').textContent = stageText[gameState.stage] || '';

    for (let i = 0; i < 5; i++) {
        const slot  = document.getElementById(`cc-${i}`);
        if (!slot) continue;
        const img   = slot.querySelector('.community-card-img');
        const label = slot.querySelector('.cc-label');
        const card  = gameState.communityCards[i];

        if (card) {
            // Use card ID stored in a data attribute to avoid absolute-vs-relative URL mismatch
            if (img.dataset.cardId !== String(card.id)) {
                img.src            = cardImagePath(card);
                img.alt            = cardAlt(card);
                img.dataset.cardId = card.id;
                img.classList.remove('card-back');
                img.classList.add('card-deal-anim');
                setTimeout(() => img.classList.remove('card-deal-anim'), 350);
            }
        } else {
            img.src = CARD_BACK;
            img.alt = 'Card back';
            img.classList.add('card-back');
            img.classList.remove('winning-card');
            delete img.dataset.cardId;
        }

        if (label) label.textContent = STAGE_LABELS[i] || '';
    }
}

function renderPlayers() {
    for (const p of players) {
        const seatEl = document.getElementById(`seat-${p.id}`);
        if (!seatEl) continue;

        // Chips
        const chipsEl = seatEl.querySelector('.player-chips');
        if (chipsEl) chipsEl.textContent = `$${p.chips.toLocaleString()}`;

        // Action label
        const actionEl = seatEl.querySelector('.player-action');
        if (actionEl) {
            actionEl.textContent = p.action || '';
            actionEl.className   = 'player-action';
            if (p.isFolded)                         actionEl.classList.add('action-fold');
            else if (p.action === 'BET' || p.action === 'RAISE') actionEl.classList.add('action-raise');
            else if (p.action === 'CALL')            actionEl.classList.add('action-call');
            else if (p.action === 'CHECK')           actionEl.classList.add('action-check');
        }

        // Hole cards
        const cardEls = seatEl.querySelectorAll('.hole-card');
        p.cards.forEach((card, i) => {
            if (!cardEls[i]) return;
            // Hero (seat 0) always sees own cards; reveal all at showdown
            const faceUp = (p.id === 0) || (gameState.stage === 'showdown' && !p.isFolded);
            if (faceUp) {
                if (cardEls[i].dataset.cardId !== String(card.id)) {
                    cardEls[i].src             = cardImagePath(card);
                    cardEls[i].alt             = cardAlt(card);
                    cardEls[i].dataset.cardId  = card.id;
                    cardEls[i].classList.add('card-deal-anim');
                    setTimeout(() => cardEls[i].classList.remove('card-deal-anim'), 350);
                }
                cardEls[i].classList.remove('card-back');
            } else {
                cardEls[i].src  = CARD_BACK;
                cardEls[i].alt  = 'Face down';
                cardEls[i].classList.add('card-back');
                cardEls[i].classList.remove('winning-card');
                delete cardEls[i].dataset.cardId;
            }
        });

        // Clear cards if none dealt
        if (p.cards.length === 0) {
            cardEls.forEach(el => {
                el.src = CARD_BACK;
                el.alt = '';
                el.classList.add('card-back');
                el.classList.remove('winning-card');
                delete el.dataset.cardId;
            });
        }

        // Folded styling
        seatEl.classList.toggle('folded', p.isFolded);

        // Winner styling (cleared in newHand via render)
        seatEl.classList.toggle('winner-seat', !!p.isWinner);

        // Hand result at showdown
        const hrEl = seatEl.querySelector('.player-hand-result');
        if (hrEl) {
            if (gameState.stage === 'showdown' && !p.isFolded && p.handResult) {
                hrEl.textContent = p.handResult.handName;
            } else {
                hrEl.textContent = '';
            }
        }

        // Badges
        const bDealer = seatEl.querySelector('.badge-dealer');
        const bSB     = seatEl.querySelector('.badge-sb');
        const bBB     = seatEl.querySelector('.badge-bb');
        if (bDealer) bDealer.style.display = p.isDealer ? 'inline-block' : 'none';
        if (bSB)     bSB.style.display     = p.isSB     ? 'inline-block' : 'none';
        if (bBB)     bBB.style.display     = p.isBB     ? 'inline-block' : 'none';
    }
}

function renderPot() {
    const el = document.getElementById('pot-amount');
    if (el) el.textContent = `$${gameState.pot.toLocaleString()}`;
}

function updateButtons() {
    const s      = gameState.stage;
    const active = activePlayers();

    document.getElementById('btn-new-hand').disabled  = false;
    document.getElementById('btn-flop').disabled      = s !== 'preflop';
    document.getElementById('btn-turn').disabled      = s !== 'flop';
    document.getElementById('btn-river').disabled     = s !== 'turn';
    document.getElementById('btn-showdown').disabled  = s !== 'river';

    // "Run it out" appears when only one player is left before all cards are dealt
    const runBtn = document.getElementById('btn-run-it-out');
    const canRun = active === 1 && (s === 'preflop' || s === 'flop' || s === 'turn');
    runBtn.style.display = canRun ? 'inline-block' : 'none';
}

function setStatus(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
    initPlayers();
    render();
    updateButtons();
    setStatus('Welcome to Poker HUD! Click "New Hand" to begin.');

    document.getElementById('btn-new-hand').addEventListener('click',   newHand);
    document.getElementById('btn-flop').addEventListener('click',      dealFlop);
    document.getElementById('btn-turn').addEventListener('click',      dealTurn);
    document.getElementById('btn-river').addEventListener('click',     dealRiver);
    document.getElementById('btn-showdown').addEventListener('click',  showdown);
    document.getElementById('btn-run-it-out').addEventListener('click', runItOut);
});
