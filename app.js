import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDCmXTaI5HiXMhsXOxmf9diIj-WPFARkFM",
    authDomain: "aymovies-d5acf.firebaseapp.com",
    databaseURL: "https://aymovies-d5acf-default-rtdb.firebaseio.com",
    projectId: "aymovies-d5acf",
    storageBucket: "aymovies-d5acf.firebasestorage.app",
    messagingSenderId: "900587660357",
    appId: "1:900587660357:web:76e61a7c12781405b32f2c",
    measurementId: "G-L7MJYD5FZQ"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = initializeFirestore(firebaseApp, { experimentalForceLongPolling: true });

let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { console.error("Wake Lock failed:", err); }
}
function releaseWakeLock() {
    if (wakeLock !== null) wakeLock.release().then(() => wakeLock = null);
}

window.scrollRow = function (rowId, direction) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const scrollAmount = row.clientWidth * 0.8;
    const maxScroll = row.scrollWidth - row.clientWidth;
    if (direction === 'left') {
        if (row.scrollLeft <= 0) row.scrollTo({ left: maxScroll, behavior: 'smooth' });
        else row.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
        if (row.scrollLeft >= maxScroll - 10) row.scrollTo({ left: 0, behavior: 'smooth' });
        else row.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
};

document.addEventListener("DOMContentLoaded", () => {

    const loginView = document.getElementById('login-view');
    const authForm = document.getElementById('auth-form');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    const authErrorMsg = document.getElementById('auth-error-message');
    const btnLogout = document.getElementById('btn-logout');

    const API_KEY = 'e00fa51658be1fc32120d60778c38fc2';
    const BASE_URL = 'https://api.themoviedb.org/3';
    const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w300';
    const HERO_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original';

    let searchTimeout = null;
    let trendingMoviesList = [];
    let currentHeroIndex = 0;
    let rotationIntervalId = null;
    let currentTvState = { id: null, season: 1, episode: 1, isTV: false };

    let currentUserUid = null;
    let continueWatching = [];
    let alreadyWatched = [];
    let myList = [];
    let progressMap = {};
    let globalCommunityMovies = [];
    let dataLoadedFromCloud = false;

    let myDeviceId = localStorage.getItem('ay_device_id');
    if (!myDeviceId) {
        myDeviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('ay_device_id', myDeviceId);
    }

    let currentModalData = null;
    let modalTrailerTimeout = null;

    window.userTotalPoints = 0.00;
    window.activeVideoStartTime = 0;
    window.watchTimerInterval = null;
    window.rewardClaimedForSession = false;

    const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxwF2aEerT5-myiVMhB6iXd50_iF0m8-GAAAZ18vA5Livbu7V6UDU810WCwhHJ7wOc/exec";

    // 🔔 CUSTOM ALERT LOGIC FOR COMMUNITY SHARE
    function showCustomAlert(message) {
        const alertModal = document.getElementById('custom-alert-modal');
        const alertMsg = document.getElementById('alert-message');
        const alertOkBtn = document.getElementById('alert-ok-btn');

        if (!alertModal) return alert(message);

        alertMsg.innerText = message;
        alertModal.style.display = "flex";

        alertOkBtn.onclick = () => {
            alertModal.style.display = "none";
        };
    }

    async function shareMovieToCommunity(movieObj) {
        if (!currentUserUid || !movieObj) return;
        const payload = {
            action: "addCommunity",
            uid: currentUserUid,
            movieData: {
                id: movieObj.id,
                title: movieObj.title || movieObj.name,
                poster_path: movieObj.poster_path
            }
        };

        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                showCustomAlert(`"${movieObj.title || movieObj.name}" was shared directly to the Community Watch list!`);
                await fetchUserData();
                renderPersonalizedRows();
            }
        } catch (e) { }
    }

    // 💰 REWARDS DRAWER LOGIC
    const rewardsDrawer = document.getElementById('rewards-drawer');
    const closeRewardsBtn = document.getElementById('close-rewards-btn');
    const btnRewardsDesktop = document.getElementById('btn-rewards-desktop');
    const btnRewardsMobile = document.getElementById('btn-rewards-mobile');
    const drawerBalance = document.getElementById('drawer-balance');
    const payoutForm = document.getElementById('payout-form');
    const payoutStatusMsg = document.getElementById('payout-status-msg');

    function updatePointsUI() {
        const formattedPoints = window.userTotalPoints.toFixed(2);
        document.querySelectorAll('.header-points-val').forEach(el => el.innerText = formattedPoints);
        const mobileMenuPoints = document.getElementById('mobile-menu-points');
        if (mobileMenuPoints) mobileMenuPoints.innerText = formattedPoints;
        if (drawerBalance) drawerBalance.innerText = formattedPoints;
    }

    function openRewardsDrawer() {
        updatePointsUI();
        rewardsDrawer.style.right = '0';
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu) mobileMenu.style.right = '-100%';
    }

    if (btnRewardsDesktop) btnRewardsDesktop.addEventListener('click', openRewardsDrawer);
    if (btnRewardsMobile) btnRewardsMobile.addEventListener('click', openRewardsDrawer);
    if (closeRewardsBtn) closeRewardsBtn.addEventListener('click', () => rewardsDrawer.style.right = '-100%');

    if (payoutForm) {
        payoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const method = document.getElementById('payout-method').value;
            const account = document.getElementById('payout-account').value;
            const amount = parseFloat(document.getElementById('payout-amount').value);

            if (isNaN(amount) || amount < 5.00) {
                payoutStatusMsg.style.color = '#E50914';
                payoutStatusMsg.innerText = '⚠️ Minimum payout request is $5.00 BZD.';
                return;
            }

            if (amount > window.userTotalPoints) {
                payoutStatusMsg.style.color = '#E50914';
                payoutStatusMsg.innerText = '⚠️ Insufficient balance!';
                return;
            }

            payoutStatusMsg.style.color = '#ffd700';
            payoutStatusMsg.innerText = '⏳ Submitting request to Google Sheet...';

            try {
                const response = await fetch(GOOGLE_SHEET_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'requestPayout',
                        uid: currentUserUid,
                        email: window.currentUserEmail || 'User',
                        method: method,
                        account: account,
                        amount: amount
                    })
                });

                if (response.ok) {
                    window.userTotalPoints = parseFloat((window.userTotalPoints - amount).toFixed(2));
                    progressMap['_points_'] = window.userTotalPoints;
                    updatePointsUI();
                    saveUserData();

                    payoutStatusMsg.style.color = '#46d369';
                    payoutStatusMsg.innerText = `✅ Request submitted! $${amount.toFixed(2)} BZD sent to processing.`;
                    payoutForm.reset();
                } else {
                    payoutStatusMsg.style.color = '#E50914';
                    payoutStatusMsg.innerText = '❌ Failed to process request. Try again later.';
                }
            } catch (err) {
                payoutStatusMsg.style.color = '#E50914';
                payoutStatusMsg.innerText = '❌ Network error during submission.';
            }
        });
    }

    // 🎯 QUICK MOOD & FILTER CHIPS LOGIC
    document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const filterType = e.target.getAttribute('data-filter');
            applyMoodFilter(filterType);
        });
    });

    function applyMoodFilter(filter) {
        const allCards = document.querySelectorAll('.movie-card');

        if (filter === 'all') {
            allCards.forEach(card => card.style.display = 'block');
            return;
        }

        allCards.forEach(card => {
            const cardTitle = (card.querySelector('.card-title')?.innerText || '').toLowerCase();
            const cardMeta = card.querySelector('.card-meta')?.innerText || '';

            let isMatch = false;

            if (filter === 'top-rated') {
                if (cardMeta.includes('⭐')) {
                    const score = parseFloat(cardMeta.split('⭐')[1]) || 0;
                    if (score >= 8.0) isMatch = true;
                }
            } else if (filter === '2026') {
                if (cardMeta.includes('2026') || cardMeta.includes('2025')) isMatch = true;
            } else if (filter === 'series') {
                if (cardMeta.toLowerCase().includes('tv') || cardTitle.includes('series')) isMatch = true;
            } else if (filter === 'action' || filter === 'comedy' || filter === 'horror') {
                const rowParent = card.closest('.row-container');
                const rowTitle = (rowParent?.querySelector('.row-title')?.innerText || '').toLowerCase();
                if (rowTitle.includes(filter) || cardTitle.includes(filter)) isMatch = true;
            }

            card.style.display = isMatch ? 'block' : 'none';
        });
    }

    // 🌐 LANGUAGE DICTIONARY & TOGGLE SYSTEM
    const translations = {
        en: {
            navHome: "Home",
            navTv: "TV Shows",
            navMovies: "Movies",
            navAnimations: "Animations",
            navSurprise: "🎲 Surprise Me",
            navLogout: "Logout",
            searchPlaceholder: "Search...",
            rowMyList: "➕ My List",
            rowContinue: "🍿 Continue Watching",
            rowWatchAgain: "🔁 Watch It Again",
            rowRecommended: "💡 Recommended For You",
            rowTop10: "🏆 Top 10 Today",
            rowCommunity: "👥 Shared Watch Party Community",
            rowTrending: "🔥 Trending Now",
            rowAction: "💥 Action Movies",
            rowComedy: "😂 Comedy Movies",
            rowSeries: "📺 Trending Series",
            btnMarkFinished: "✔️ Mark Finished"
        },
        es: {
            navHome: "Inicio",
            navTv: "Series TV",
            navMovies: "Películas",
            navAnimations: "Animación",
            navSurprise: "🎲 Sorpréndeme",
            navLogout: "Cerrar sesión",
            searchPlaceholder: "Buscar...",
            rowMyList: "➕ Mi Lista",
            rowContinue: "🍿 Continuar Viendo",
            rowWatchAgain: "🔁 Volver a Ver",
            rowRecommended: "💡 Recomendado para Ti",
            rowTop10: "🏆 Top 10 Hoy",
            rowCommunity: "👥 Comunidad Watch Party",
            rowTrending: "🔥 Tendencias Ahora",
            rowAction: "💥 Películas de Acción",
            rowComedy: "😂 Películas de Comedia",
            rowSeries: "📺 Series en Tendencia",
            btnMarkFinished: "✔️ Marcar Terminado"
        }
    };

    let currentLang = localStorage.getItem('ay_language') || 'en';

    function setAppLanguage(lang) {
        currentLang = lang;
        localStorage.setItem('ay_language', lang);

        const langDesktop = document.getElementById('lang-select');
        const langMobile = document.getElementById('lang-select-mobile');
        if (langDesktop) langDesktop.value = lang;
        if (langMobile) langMobile.value = lang;

        const dict = translations[lang] || translations.en;

        document.querySelectorAll('[data-view="home"]').forEach(el => el.innerText = dict.navHome);
        document.querySelectorAll('[data-view="tv"]').forEach(el => el.innerText = dict.navTv);
        document.querySelectorAll('[data-view="movies"]').forEach(el => el.innerText = dict.navMovies);
        document.querySelectorAll('[data-view="animations"]').forEach(el => el.innerText = dict.navAnimations);

        const searchInp = document.getElementById('search-input');
        if (searchInp) searchInp.placeholder = dict.searchPlaceholder;

        const rowTitles = {
            'row1-title': dict.rowTrending,
            'row2-title': dict.rowAction,
            'row3-title': dict.rowComedy,
            'row4-title': dict.rowSeries
        };

        for (const [id, titleText] of Object.entries(rowTitles)) {
            const titleEl = document.getElementById(id);
            if (titleEl) titleEl.innerText = titleText;
        }
    }

    ['lang-select', 'lang-select-mobile'].forEach(selectId => {
        const el = document.getElementById(selectId);
        if (el) {
            el.addEventListener('change', (e) => setAppLanguage(e.target.value));
        }
    });

    setAppLanguage(currentLang);

    function getServerStreamUrl(serverKey, id, isTV = false, season = 1, episode = 1) {
        switch (serverKey) {
            case 'vidsrc2':
                return isTV ? `https://vidsrc.cc/v2/embed/tv/${id}/${season}/${episode}` : `https://vidsrc.cc/v2/embed/movie/${id}`;
            case 'vidlink':
                return isTV ? `https://vidlink.pro/tv/${id}/${season}/${episode}` : `https://vidlink.pro/movie/${id}`;
            case 'vidsrc':
            default:
                return isTV ? `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}` : `https://vidsrc.me/embed/movie?tmdb=${id}`;
        }
    }

    function showRewardToast(title, message) {
        let toast = document.getElementById('reward-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'reward-toast';
            toast.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(20, 20, 20, 0.95); border: 2px solid #ffd700;
                box-shadow: 0 0 25px rgba(255, 215, 0, 0.6); color: white; padding: 24px 40px;
                border-radius: 8px; z-index: 10002; text-align: center; font-family: Arial, sans-serif;
                pointer-events: none; transition: opacity 0.5s ease-in-out;
            `;
            document.body.appendChild(toast);
        }

        toast.innerHTML = `<div style="font-size: 1.6rem; font-weight: bold; color: #ffd700; margin-bottom: 8px;">${title}</div><div style="font-size: 1.1rem; color: #ffffff;">${message}</div>`;
        toast.style.opacity = '1';
        toast.style.display = 'block';

        setTimeout(() => {
            if (toast) {
                toast.style.opacity = '0';
                setTimeout(() => { toast.style.display = 'none'; }, 500);
            }
        }, 5000);
    }

    const profileIcon = document.getElementById('profile-icon');
    const avatarDropdown = document.getElementById('avatar-dropdown');
    const customAvatars = ['👤', '🔴', '🔵', '🟢', '👾', '🐧', '😎', '🍿', '👻', '👑', '👽', '🤖', '🦊', '🐯', '🍕', '🎬', '🎮', '🔥', '💎', '🚀', '🐼', '🐉', '🎸', '🌮'];

    profileIcon.addEventListener('click', () => { avatarDropdown.style.display = avatarDropdown.style.display === 'flex' ? 'none' : 'flex'; });

    customAvatars.forEach(av => {
        const span = document.createElement('span');
        span.innerText = av;
        span.style.cssText = "font-size: 1.8rem; cursor: pointer; transition: transform 0.2s;";
        span.onmouseover = () => span.style.transform = "scale(1.3)";
        span.onmouseout = () => span.style.transform = "scale(1)";
        span.onclick = () => {
            profileIcon.innerText = av;
            const mobileMenuAvatar = document.getElementById('mobile-menu-avatar');
            if (mobileMenuAvatar) mobileMenuAvatar.innerText = av;
            avatarDropdown.style.display = 'none';
            if (currentUserUid) saveUserData();
        };
        avatarDropdown.appendChild(span);
    });

    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeMobileMenu = document.getElementById('close-mobile-menu');
    const mobileMenu = document.getElementById('mobile-menu');
    const btnLogoutMobile = document.getElementById('btn-logout-mobile');
    const btnSurpriseMobile = document.getElementById('btn-surprise-mobile');

    const homeView = document.getElementById('home-view');
    const searchInput = document.getElementById('search-input');
    const searchDropdown = document.getElementById('search-dropdown');

    const videoModal = document.getElementById('video-modal');
    const videoPlayerFrame = document.getElementById('video-player-frame');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const btnPrevEp = document.getElementById('btn-prev-ep');
    const btnNextEp = document.getElementById('btn-next-ep');
    const btnMarkFinished = document.getElementById('btn-mark-finished');
    const episodeIndicatorText = document.getElementById('episode-indicator-text');
    const serverSelect = document.getElementById('server-select');

    const heroDisplayTitle = document.getElementById('hero-display-title');
    const heroDisplayLogo = document.getElementById('hero-display-logo');
    const heroDisplayDesc = document.getElementById('hero-display-desc');
    const heroPosterBg = document.getElementById('hero-poster-bg');
    const heroPlayBtn = document.getElementById('hero-play-btn');
    const heroPlayerFrame = document.getElementById('hero-player-frame');
    const heroMuteBtn = document.getElementById('hero-mute-btn');
    let isHeroMuted = true;

    const heroPrev = document.getElementById('hero-prev');
    const heroNext = document.getElementById('hero-next');
    const heroDotsContainer = document.getElementById('hero-dots');

    const detailsModal = document.getElementById('details-modal');
    const closeDetailsBtn = document.getElementById('close-details-btn');
    const detailsPlayBtn = document.getElementById('details-play-btn');
    const detailsTrailerBtn = document.getElementById('details-trailer-btn');
    const detailsMylistBtn = document.getElementById('details-mylist-btn');
    const modalTrailerFrame = document.getElementById('modal-trailer-frame');
    const modalTvControls = document.getElementById('modal-tv-controls');
    const modalSeasonSelect = document.getElementById('modal-season-select');
    const modalEpisodeSelect = document.getElementById('modal-episode-select');
    const modalSimilarRow = document.getElementById('modal-similar-row');

    const actorModal = document.getElementById('actor-modal');
    const closeActorBtn = document.getElementById('close-actor-btn');
    const actorNameEl = document.getElementById('actor-name');
    const actorBioEl = document.getElementById('actor-bio');
    const actorPhotoEl = document.getElementById('actor-photo');
    const actorMoviesRow = document.getElementById('actor-movies-row');

    if (closeActorBtn) closeActorBtn.addEventListener('click', () => { actorModal.style.display = 'none'; });

    async function fetchUserData() {
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify({ action: "fetch", uid: currentUserUid })
            });
            const result = await response.json();

            if (response.ok && result.exists) {
                const data = result.data;
                progressMap = data.progress || {};
                profileIcon.innerText = data.avatar || '👤';
                myList = data.myList || [];
                continueWatching = data.continueWatching || [];
                alreadyWatched = data.alreadyWatched || [];

                window.userTotalPoints = parseFloat(progressMap['_points_']) || 0.00;
                updatePointsUI();
                dataLoadedFromCloud = true;
            } else if (response.ok && !result.exists) {
                initializeFreshProfile();
                dataLoadedFromCloud = true;
                saveUserData();
            }
            globalCommunityMovies = result.communityList || [];
        } catch (e) { }
    }

    async function saveUserData() {
        if (!currentUserUid || !dataLoadedFromCloud) return;
        progressMap['_active_device_'] = myDeviceId;
        try {
            fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify({
                    action: "save",
                    uid: currentUserUid,
                    userData: { avatar: profileIcon.innerText, myList: myList, continueWatching: continueWatching, alreadyWatched: alreadyWatched, progress: progressMap }
                })
            });
        } catch (e) { }
    }

    function initializeFreshProfile() {
        profileIcon.innerText = '👤';
        myList = [];
        continueWatching = [];
        alreadyWatched = [];
        progressMap = {};
        window.userTotalPoints = 0.00;
        updatePointsUI();
        saveUserData();
    }

    function shiftHero(direction) {
        if (trendingMoviesList.length === 0) return;
        if (direction === 'next') currentHeroIndex = (currentHeroIndex + 1) % trendingMoviesList.length;
        else currentHeroIndex = (currentHeroIndex - 1 + trendingMoviesList.length) % trendingMoviesList.length;
        updateHeroBillboard(trendingMoviesList[currentHeroIndex]);
    }
    heroPrev.addEventListener('click', () => shiftHero('prev'));
    heroNext.addEventListener('click', () => shiftHero('next'));

    mobileMenuBtn.addEventListener('click', () => { mobileMenu.style.right = '0'; });
    closeMobileMenu.addEventListener('click', () => { mobileMenu.style.right = '-100%'; });

    function handleLogout() { mobileMenu.style.right = '-100%'; signOut(auth); }
    btnLogout.addEventListener('click', handleLogout);
    btnLogoutMobile.addEventListener('click', handleLogout);

    onAuthStateChanged(auth, (user) => {
        if (user) {
            if (currentUserUid === user.uid) return;
            currentUserUid = user.uid;
            window.currentUserEmail = user.email || "Registered User";
            loginView.style.display = 'none';
            loadCategoryView('home');
            fetchUserData().then(() => { renderPersonalizedRows(); syncProgressBars(); });
        } else {
            currentUserUid = null;
            loginView.style.display = 'flex';
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await signInWithEmailAndPassword(auth, authEmailInput.value, authPasswordInput.value);
            authErrorMsg.innerText = "";
        } catch (error) {
            authErrorMsg.innerText = "Incorrect email or password.";
        }
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            const view = e.target.getAttribute('data-view');
            document.querySelectorAll(`[data-view="${view}"]`).forEach(l => l.classList.add('active'));
            mobileMenu.style.right = '-100%';
            loadCategoryView(view);
        });
    });

    function syncProgressBars() {
        if (!currentUserUid) return;
        const cards = document.querySelectorAll('.movie-card, .top-10-wrapper');

        cards.forEach(card => {
            const id = card.getAttribute('data-id');
            let rawProgress = progressMap[id];
            let savedProgress = rawProgress ? (typeof rawProgress === 'object' ? rawProgress.percent : rawProgress) : null;

            let track = card.querySelector('.progress-track');
            if (savedProgress) {
                if (!track) {
                    track = document.createElement('div');
                    track.className = 'progress-track';
                    const fill = document.createElement('div');
                    fill.className = 'progress-fill';
                    track.appendChild(fill);
                    card.appendChild(track);
                }
                const fill = track.querySelector('.progress-fill');
                fill.style.width = `${savedProgress}%`;
                fill.style.background = savedProgress === '100' ? '#46d369' : '#E50914';
            } else if (track) { track.remove(); }
        });
    }

    async function loadCategoryView(viewType) {
        renderPersonalizedRows();
        const top10Container = document.getElementById('top-10-container');
        const top10Row = document.getElementById('top-10-row');
        const row1 = document.getElementById('trending-row');
        const row2 = document.getElementById('action-row');
        const row3 = document.getElementById('comedy-row');
        const row4 = document.getElementById('series-row');

        try {
            if (viewType === 'home') {
                top10Container.style.display = 'block';
                const tData = await (await fetch(`${BASE_URL}/trending/all/day?api_key=${API_KEY}`)).json();
                populateTop10Row(tData.results.slice(0, 10), top10Row);
                populateRow(tData.results, row1, false);
                setupHero(tData.results.slice(0, 5));

                const aData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=28`)).json();
                populateRow(aData.results, row2, false);

                const cData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=35`)).json();
                populateRow(cData.results, row3, false);

                const sData = await (await fetch(`${BASE_URL}/trending/tv/day?api_key=${API_KEY}`)).json();
                populateRow(sData.results, row4, true);
            } else if (viewType === 'tv') {
                top10Container.style.display = 'none';
                const tData = await (await fetch(`${BASE_URL}/trending/tv/week?api_key=${API_KEY}`)).json();
                populateRow(tData.results, row1, true);
                setupHero(tData.results.slice(0, 5), true);
                const aData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=10759`)).json();
                populateRow(aData.results, row2, true);
                const cData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=35`)).json();
                populateRow(cData.results, row3, true);
                const dData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=18`)).json();
                populateRow(dData.results, row4, true);
            } else if (viewType === 'movies') {
                top10Container.style.display = 'none';
                const tData = await (await fetch(`${BASE_URL}/trending/movie/week?api_key=${API_KEY}`)).json();
                populateRow(tData.results, row1, false);
                setupHero(tData.results.slice(0, 5));
                const aData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=28`)).json();
                populateRow(aData.results, row2, false);
                const cData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=35`)).json();
                populateRow(cData.results, row3, false);
                const hData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=27`)).json();
                populateRow(hData.results, row4, false);
            } else if (viewType === 'animations') {
                top10Container.style.display = 'none';
                const animMovData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json();
                populateRow(animMovData.results, row1, false);
                setupHero(animMovData.results.slice(0, 5));
                const animTvData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json();
                populateRow(animTvData.results, row2, true);
                const familyAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16,10751&sort_by=popularity.desc`)).json();
                populateRow(familyAnimData.results, row3, false);
                const trendingAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=vote_count.desc`)).json();
                populateRow(trendingAnimData.results, row4, false);
            }
        } catch (error) { }
        syncProgressBars();
    }

    function setupHero(results, isTV = false) {
        if (results && results.length > 0) {
            trendingMoviesList = results.map(item => ({ ...item, isTV: isTV }));
            currentHeroIndex = 0;
            updateHeroBillboard(trendingMoviesList[0]);
        }
    }

    async function renderPersonalizedRows() {
        const myListContainer = document.getElementById('my-list-container');
        const myListRow = document.getElementById('my-list-row');
        const cwContainer = document.getElementById('continue-watching-container');
        const cwRow = document.getElementById('continue-watching-row');
        const communityContainer = document.getElementById('community-container');
        const communityRow = document.getElementById('community-row');

        if (myList.length > 0) {
            myListContainer.style.display = 'block';
            populateRow(myList, myListRow, false);
        } else { myListContainer.style.display = 'none'; }

        if (continueWatching.length > 0) {
            cwContainer.style.display = 'block';
            populateRow(continueWatching, cwRow, false);
        } else { cwContainer.style.display = 'none'; }

        if (globalCommunityMovies.length > 0 && communityContainer && communityRow) {
            communityContainer.style.display = 'block';
            communityRow.innerHTML = '';
            globalCommunityMovies.forEach(item => {
                const movieId = item.id || item.movieId || item[0];
                const movieTitle = item.title || item.movieTitle || item.name || item[1];
                const moviePoster = item.poster_path || item.posterPath || item[2];
                if (!movieId || !moviePoster) return;

                const card = document.createElement('div');
                card.className = 'movie-card';
                card.setAttribute('data-id', movieId.toString());
                card.innerHTML = `<img src="${IMAGE_BASE_URL}${moviePoster}"><div class="card-info"><div class="card-title">${movieTitle}</div><div class="card-meta"><span style="color:#e50914;">👥 Shared Party</span></div></div>`;
                card.addEventListener('click', () => openDetailsModal(movieId, false));
                communityRow.appendChild(card);
            });
        } else if (communityContainer) {
            communityContainer.style.display = 'none';
        }

        syncProgressBars();
    }

    async function openActorModal(personId) {
        try {
            const res = await fetch(`${BASE_URL}/person/${personId}?api_key=${API_KEY}&append_to_response=combined_credits`);
            const data = await res.json();
            actorNameEl.innerText = data.name;
            actorBioEl.innerText = data.biography || "No biography available.";
            actorPhotoEl.src = data.profile_path ? `${IMAGE_BASE_URL}${data.profile_path}` : 'https://via.placeholder.com/200x300?text=No+Image';
            const sortedMovies = data.combined_credits.cast.sort((a, b) => b.popularity - a.popularity);
            populateRow(sortedMovies, actorMoviesRow, false);
            actorModal.style.display = 'block';
        } catch (e) { }
    }

    async function fetchMovieTrailer(movieId, isTV = false) {
        try {
            const type = isTV ? 'tv' : 'movie';
            const res = await fetch(`${BASE_URL}/${type}/${movieId}/videos?api_key=${API_KEY}`);
            const data = await res.json();
            const trailer = data.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
            return trailer ? trailer.key : null;
        } catch (error) { return null; }
    }

    async function populateModalEpisodes(tvId, seasonNumber) {
        modalEpisodeSelect.innerHTML = '<option>Loading...</option>';
        try {
            const res = await fetch(`${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}`);
            const data = await res.json();
            modalEpisodeSelect.innerHTML = '';
            data.episodes.forEach(e => {
                const option = document.createElement('option');
                option.value = e.episode_number;
                option.innerText = `Ep ${e.episode_number}: ${e.name}`;
                modalEpisodeSelect.appendChild(option);
            });
        } catch (e) { }
    }

    async function openDetailsModal(id, isTV) {
        try {
            document.querySelector('.details-content').scrollTop = 0;
            clearTimeout(modalTrailerTimeout);
            modalTrailerFrame.src = "";
            modalTrailerFrame.style.display = 'none';

            const type = isTV ? 'tv' : 'movie';
            const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&append_to_response=credits,similar`);
            const data = await res.json();
            currentModalData = data;
            currentModalData.media_type = type;

            document.getElementById('details-title').innerText = data.title || data.name;
            document.getElementById('details-desc').innerText = data.overview || "No description available.";
            document.getElementById('details-rating').innerText = `⭐ ${parseFloat(data.vote_average || 0).toFixed(1)} Rating`;
            const releaseDate = data.release_date || data.first_air_date;
            document.getElementById('details-year').innerText = releaseDate ? releaseDate.substring(0, 4) : "N/A";
            document.getElementById('details-hero').style.backgroundImage = `url('${HERO_IMAGE_BASE_URL}${data.backdrop_path || data.poster_path}')`;

            const castContainer = document.getElementById('details-cast');
            castContainer.innerHTML = '';
            if (data.credits && data.credits.cast && data.credits.cast.length > 0) {
                data.credits.cast.slice(0, 6).forEach((c, index) => {
                    const span = document.createElement('span');
                    span.innerText = c.name + (index < 5 ? ", " : "");
                    span.style.cssText = "cursor: pointer; color: #fff; text-decoration: underline; margin-right: 5px; transition: color 0.2s;";
                    span.onclick = () => openActorModal(c.id);
                    castContainer.appendChild(span);
                });
            } else { castContainer.innerText = "Cast information unavailable."; }

            if (data.similar && data.similar.results && data.similar.results.length > 0) {
                const formattedSimilar = data.similar.results.map(item => ({ ...item, media_type: type }));
                populateRow(formattedSimilar, modalSimilarRow, isTV);
            } else { modalSimilarRow.innerHTML = "<p style='color: #aaa;'>No similar titles found.</p>"; }

            // ✅ Inject Community Share Button
            const detailsBtnGroup = document.getElementById('details-btn-group');
            const oldShareBtn = document.getElementById('details-community-btn');
            if(oldShareBtn) oldShareBtn.remove();
            
            const communityShareBtn = document.createElement('button');
            communityShareBtn.id = "details-community-btn";
            communityShareBtn.style.cssText = "padding: 12px 30px; font-size: 1.2rem; font-weight: bold; background: rgba(229, 9, 20, 0.2); color: #fff; border: 1px solid #E50914; border-radius: 5px; cursor: pointer; transition: 0.2s;";
            communityShareBtn.innerText = "👥 Share to Community";
            communityShareBtn.onmouseover = () => communityShareBtn.style.background = "#E50914";
            communityShareBtn.onmouseout = () => communityShareBtn.style.background = "rgba(229, 9, 20, 0.2)";
            communityShareBtn.onclick = () => shareMovieToCommunity(currentModalData);
            detailsBtnGroup.appendChild(communityShareBtn);

            modalTrailerTimeout = setTimeout(async () => {
                const trailerKey = await fetchMovieTrailer(id, isTV);
                if (trailerKey) {
                    modalTrailerFrame.style.display = 'block';
                    modalTrailerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=0&controls=0&showinfo=0&rel=0`;
                }
            }, 500);

            detailsTrailerBtn.onclick = async () => {
                clearTimeout(modalTrailerTimeout);
                const trailerKey = await fetchMovieTrailer(id, isTV);
                if (trailerKey) {
                    modalTrailerFrame.style.display = 'block';
                    modalTrailerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=1&showinfo=0&rel=0`;
                } else { alert("Trailer not available."); }
            };

            if (isTV && data.seasons) {
                modalTvControls.style.display = 'flex';
                modalSeasonSelect.innerHTML = '';
                const validSeasons = data.seasons.filter(s => s.season_number > 0);
                validSeasons.forEach(s => {
                    const option = document.createElement('option');
                    option.value = s.season_number;
                    option.innerText = `Season ${s.season_number}`;
                    modalSeasonSelect.appendChild(option);
                });

                if (validSeasons.length > 0) { await populateModalEpisodes(id, modalSeasonSelect.value); }
                modalSeasonSelect.onchange = async (e) => { await populateModalEpisodes(id, e.target.value); };

                detailsPlayBtn.onclick = () => {
                    clearTimeout(modalTrailerTimeout);
                    detailsModal.style.display = 'none';
                    modalTrailerFrame.src = "";
                    launchVideoStream(id, true, modalSeasonSelect.value, modalEpisodeSelect.value);
                };
            } else {
                modalTvControls.style.display = 'none';
                detailsPlayBtn.onclick = () => {
                    clearTimeout(modalTrailerTimeout);
                    detailsModal.style.display = 'none';
                    modalTrailerFrame.src = "";
                    launchVideoStream(id, false);
                };
            }

            detailsModal.style.display = 'block';
        } catch (error) { }
    }

    closeDetailsBtn.addEventListener('click', () => {
        clearTimeout(modalTrailerTimeout);
        detailsModal.style.display = 'none';
        modalTrailerFrame.src = "";
    });

    function launchVideoStream(id, isTV = false, season = 1, episode = 1) {
        currentTvState = { id, isTV, season: parseInt(season), episode: parseInt(episode) };
        window.activeVideoStartTime = Date.now();
        window.rewardClaimedForSession = false;

        requestWakeLock();

        if (isTV) {
            btnPrevEp.style.display = currentTvState.episode > 1 ? 'inline-block' : 'none';
            btnNextEp.style.display = 'inline-block';
            episodeIndicatorText.innerText = `Playing: Season ${season}, Episode ${episode}`;
        } else {
            btnPrevEp.style.display = 'none';
            btnNextEp.style.display = 'none';
            episodeIndicatorText.innerText = "Feature Film";
        }

        const activeServer = serverSelect ? serverSelect.value : 'vidsrc';
        videoPlayerFrame.src = getServerStreamUrl(activeServer, id, isTV, season, episode);
        videoModal.style.display = 'block';

        if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);
        window.watchTimerInterval = setInterval(() => {
            if (!currentUserUid || window.rewardClaimedForSession) return;
            const elapsedMinutes = (Date.now() - window.activeVideoStartTime) / 60000;

            if (!currentTvState.isTV && elapsedMinutes >= 60) {
                window.rewardClaimedForSession = true;
                window.userTotalPoints = parseFloat((window.userTotalPoints + 0.25).toFixed(2));
                progressMap['_points_'] = window.userTotalPoints;
                updatePointsUI();
                saveUserData();
                showRewardToast("🍿 Reward Earned!", "You earned $0.25 BZD for watching 1 hour!");
            }
        }, 10000);
    }

    if (serverSelect) {
        serverSelect.addEventListener('change', (e) => {
            if (currentTvState.id) {
                videoPlayerFrame.src = getServerStreamUrl(
                    e.target.value, currentTvState.id, currentTvState.isTV, currentTvState.season, currentTvState.episode
                );
            }
        });
    }

    btnNextEp.addEventListener('click', () => {
        if (!currentTvState.isTV) return;
        currentTvState.episode += 1;
        launchVideoStream(currentTvState.id, true, currentTvState.season, currentTvState.episode);
    });

    btnPrevEp.addEventListener('click', () => {
        if (!currentTvState.isTV || currentTvState.episode <= 1) return;
        currentTvState.episode -= 1;
        launchVideoStream(currentTvState.id, true, currentTvState.season, currentTvState.episode);
    });

    btnMarkFinished.addEventListener('click', () => {
        if (currentUserUid && currentTvState.id) {
            window.userTotalPoints = parseFloat((window.userTotalPoints + 0.25).toFixed(2));
            progressMap['_points_'] = window.userTotalPoints;
            progressMap[currentTvState.id] = '100';
            updatePointsUI();
            saveUserData();
            btnMarkFinished.innerText = "⭐ Saved & Rewarded!";
            setTimeout(() => { btnMarkFinished.innerText = "✔️ Mark Finished"; }, 3000);
            syncProgressBars();
        }
    });

    closeModalBtn.addEventListener('click', () => {
        if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);
        videoModal.style.display = 'none';
        videoPlayerFrame.src = "";
        releaseWakeLock();
    });

    async function updateHeroBillboard(featuredMovie) {
        if (!featuredMovie) return;
        heroDisplayTitle.innerText = (featuredMovie.title || featuredMovie.name).toUpperCase();
        heroDisplayDesc.innerText = featuredMovie.overview || "";
        heroPosterBg.style.backgroundImage = `url('${HERO_IMAGE_BASE_URL}${featuredMovie.backdrop_path}')`;
        heroPlayBtn.onclick = () => openDetailsModal(featuredMovie.id, featuredMovie.isTV);
    }

    function populateTop10Row(movies, container) {
        if (!container) return;
        container.innerHTML = '';
        movies.forEach((item, index) => {
            if (!item.poster_path) return;
            const card = document.createElement('div');
            card.className = 'top-10-wrapper';
            card.setAttribute('data-id', item.id);
            card.innerHTML = `<span class="top-10-number">${index + 1}</span><img src="${IMAGE_BASE_URL}${item.poster_path}" class="top-10-poster">`;
            card.addEventListener('click', () => openDetailsModal(item.id, item.media_type === 'tv'));
            container.appendChild(card);
        });
    }

    function populateRow(movies, container, isTV = false) {
        if (!container) return;
        container.innerHTML = '';
        movies.forEach(item => {
            if (!item.poster_path) return;
            const card = createMovieCard(item, isTV);
            container.appendChild(card);
        });
    }

    function createMovieCard(item, isTV = false) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.setAttribute('data-id', item.id);

        const year = (item.release_date || item.first_air_date || "N/A").substring(0, 4);
        const rating = parseFloat(item.vote_average || 0).toFixed(1);

        card.innerHTML = `
            <img src="${IMAGE_BASE_URL}${item.poster_path}" alt="${item.title || item.name}">
            <div class="card-info">
                <div class="card-title">${item.title || item.name}</div>
                <div class="card-meta"><span>${year}</span> <span>⭐ ${rating}</span></div>
            </div>
        `;

        card.addEventListener('click', () => openDetailsModal(item.id, isTV));
        return card;
    }

    async function checkSessionLock() {
        if (!currentUserUid || !dataLoadedFromCloud) return;
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify({ action: "fetch", uid: currentUserUid, cacheBust: Date.now() })
            });
            const result = await response.json();

            if (result.exists) {
                const currentCloudDevice = (result.data.progress || {})['_active_device_'];
                if (currentCloudDevice && currentCloudDevice !== myDeviceId) {
                    document.body.innerHTML = `
                        <div style="background:#000; color:#fff; position:fixed; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:999999; text-align:center; padding:20px; font-family:sans-serif;">
                            <h1 style="color:#e50914; margin-bottom: 15px;">🚫 SESSION TERMINATED</h1>
                            <p style="font-size: 1.1rem; line-height: 1.5;">Logged in on another device.</p>
                        </div>
                    `;
                    setTimeout(() => { signOut(auth).then(() => window.location.reload()); }, 3000);
                }
            }
        } catch (e) { }
    }

    setInterval(checkSessionLock, 15000);
});
