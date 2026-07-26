import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const db = initializeFirestore(firebaseApp, {
    experimentalForceLongPolling: true
});

let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
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

    // ✨ GLOBAL TRACKERS FOR POINTS & TIMERS
    window.userTotalPoints = 0.00;
    window.activeVideoStartTime = 0;
    window.watchTimerInterval = null;
    window.rewardClaimedForSession = false;

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

        const myListH2 = document.querySelector('#my-list-container .row-title');
        if (myListH2) myListH2.innerText = dict.rowMyList;

        const cwH2 = document.querySelector('#continue-watching-container .row-title');
        if (cwH2) cwH2.innerText = dict.rowContinue;

        const awH2 = document.querySelector('#already-watched-container .row-title');
        if (awH2) awH2.innerText = dict.rowWatchAgain;

        const recH2 = document.querySelector('#recommended-container .row-title');
        if (recH2) recH2.innerText = dict.rowRecommended;

        const top10H2 = document.querySelector('#top-10-container .row-title');
        if (top10H2) top10H2.innerText = dict.rowTop10;

        const commH2 = document.querySelector('#community-container .row-title');
        if (commH2) commH2.innerText = dict.rowCommunity;
    }

    ['lang-select', 'lang-select-mobile'].forEach(selectId => {
        const el = document.getElementById(selectId);
        if (el) {
            el.addEventListener('change', (e) => setAppLanguage(e.target.value));
        }
    });

    setAppLanguage(currentLang);

    // 📡 MULTI-SERVER STREAM URL GENERATOR (3 VERIFIED SERVERS)
    function getServerStreamUrl(serverKey, id, isTV = false, season = 1, episode = 1) {
        switch (serverKey) {
            case 'vidsrc2':
                return isTV 
                    ? `https://vidsrc.cc/v2/embed/tv/${id}/${season}/${episode}`
                    : `https://vidsrc.cc/v2/embed/movie/${id}`;
                    
            case 'vidlink':
                return isTV 
                    ? `https://vidlink.pro/tv/${id}/${season}/${episode}`
                    : `https://vidlink.pro/movie/${id}`;
                    
            case 'vidsrc':
            default:
                return isTV 
                    ? `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
                    : `https://vidsrc.me/embed/movie?tmdb=${id}`;
        }
    }

    // ✨ FLOATING REWARD TOAST POPUP (CENTERED, PAUSE & RESUME)
    function showRewardToast(title, message) {
        let toast = document.getElementById('reward-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'reward-toast';
            toast.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(20, 20, 20, 0.95);
                border: 2px solid #ffd700;
                box-shadow: 0 0 25px rgba(255, 215, 0, 0.6);
                color: white;
                padding: 24px 40px;
                border-radius: 8px;
                z-index: 10002;
                text-align: center;
                font-family: Arial, sans-serif;
                pointer-events: none;
                transition: opacity 0.5s ease-in-out;
            `;
            document.body.appendChild(toast);
        }

        toast.innerHTML = `
            <div style="font-size: 1.6rem; font-weight: bold; color: #ffd700; margin-bottom: 8px;">${title}</div>
            <div style="font-size: 1.1rem; color: #ffffff;">${message}</div>
        `;
        toast.style.opacity = '1';
        toast.style.display = 'block';

        const player = document.getElementById('video-player-frame');
        if (player && player.contentWindow) {
            try {
                player.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                player.contentWindow.postMessage('pause', '*');
                player.contentWindow.postMessage({ method: 'pause' }, '*');
            } catch (e) { }
        }

        setTimeout(() => {
            if (toast) {
                toast.style.opacity = '0';
                setTimeout(() => { toast.style.display = 'none'; }, 500);
            }

            if (player && player.contentWindow) {
                try {
                    player.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                    player.contentWindow.postMessage('play', '*');
                    player.contentWindow.postMessage({ method: 'play' }, '*');
                } catch (e) { }
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

    const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxwF2aEerT5-myiVMhB6iXd50_iF0m8-GAAAZ18vA5Livbu7V6UDU810WCwhHJ7wOc/exec";

    async function fetchUserData() {
        console.log("☁️ Requesting profile from Google Sheets...");
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify({ action: "fetch", uid: currentUserUid })
            });

            const result = await response.json();

            if (response.ok && result.exists) {
                const data = result.data;

                progressMap = data.progress || {};
                const cloudDeviceId = progressMap['_active_device_'];

                if (cloudDeviceId && cloudDeviceId !== myDeviceId) {
                    const takeOver = confirm("🚫 ACCOUNT IN USE\n\nThis account is currently active on another device.\n\nDo you want to log out the other device and take over?");

                    if (!takeOver) {
                        window.isKickedOut = true;
                        const overlay = document.createElement('div');
                        overlay.id = 'access-denied-overlay';
                        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#000; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:999999; text-align:center; padding:20px; font-family:sans-serif;';
                        overlay.innerHTML = `
                            <h1 style="color:#e50914; margin-bottom: 15px;">🚫 ACCESS DENIED</h1>
                            <p style="font-size: 1.1rem; line-height: 1.5;">This account is currently in use on another device.<br>Logging out...</p>
                        `;
                        document.body.appendChild(overlay);

                        setTimeout(() => {
                            firebase.auth().signOut().then(() => {
                                window.location.reload();
                            }).catch(() => {
                                window.location.reload();
                            });
                        }, 2000);
                        return;
                    }
                }

                profileIcon.innerText = data.avatar || '👤';
                myList = data.myList || [];
                continueWatching = data.continueWatching || [];
                alreadyWatched = data.alreadyWatched || [];

                window.userTotalPoints = parseFloat(progressMap['_points_']) || 0.00;
                const mobileMenuPoints = document.getElementById('mobile-menu-points');
                const mobileMenuAvatar = document.getElementById('mobile-menu-avatar');
                const mobileMenuEmail = document.getElementById('mobile-menu-email');

                if (mobileMenuPoints) mobileMenuPoints.innerText = window.userTotalPoints.toFixed(2);
                if (mobileMenuAvatar) mobileMenuAvatar.innerText = data.avatar || '👤';
                if (mobileMenuEmail) mobileMenuEmail.innerText = window.currentUserEmail || "Registered User";

                dataLoadedFromCloud = true;

                if (cloudDeviceId !== myDeviceId) {
                    window.takeoverImmunity = true;
                    saveUserData();
                    setTimeout(() => { window.takeoverImmunity = false; }, 20000);
                }

            } else if (response.ok && !result.exists) {
                initializeFreshProfile();
                dataLoadedFromCloud = true;
                saveUserData();
            }

            globalCommunityMovies = result.communityList || [];

        } catch (e) {
            console.error("❌ Network glitch! Google Sheet didn't answer in time.");
        }
    }

    async function saveUserData() {
        if (window.isKickedOut) return;
        if (!currentUserUid || !dataLoadedFromCloud) return;

        progressMap['_active_device_'] = myDeviceId;

        const payload = {
            action: "save",
            uid: currentUserUid,
            userData: {
                avatar: profileIcon.innerText,
                myList: myList,
                continueWatching: continueWatching,
                alreadyWatched: alreadyWatched,
                progress: progressMap
            }
        };

        try {
            fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify(payload)
            });
        } catch (e) { }
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
                alert(`✨ "${movieObj.title || movieObj.name}" added directly to Shared Community Watch list!`);
                await fetchUserData();
                renderPersonalizedRows();
            }
        } catch (e) { }
    }

    function initializeFreshProfile() {
        profileIcon.innerText = '👤';
        myList = [];
        continueWatching = [];
        alreadyWatched = [];
        progressMap = {};

        window.userTotalPoints = 0.00;
        const mobileMenuPoints = document.getElementById('mobile-menu-points');
        const mobileMenuAvatar = document.getElementById('mobile-menu-avatar');
        const mobileMenuEmail = document.getElementById('mobile-menu-email');
        if (mobileMenuPoints) mobileMenuPoints.innerText = "0.00";
        if (mobileMenuAvatar) mobileMenuAvatar.innerText = '👤';
        if (mobileMenuEmail) mobileMenuEmail.innerText = window.currentUserEmail || "Registered User";

        saveUserData();
    }

    function shiftHero(direction) {
        if (trendingMoviesList.length === 0) return;
        if (direction === 'next') currentHeroIndex = (currentHeroIndex + 1) % trendingMoviesList.length;
        else currentHeroIndex = (currentHeroIndex - 1 + trendingMoviesList.length) % trendingMoviesList.length;
        updateHeroBillboard(trendingMoviesList[currentHeroIndex]);
        startHeroRotationLoop();
    }
    heroPrev.addEventListener('click', () => shiftHero('prev'));
    heroNext.addEventListener('click', () => shiftHero('next'));

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

    const detailsBtnGroup = detailsPlayBtn.parentElement;
    const communityShareBtn = document.createElement('button');
    communityShareBtn.id = "details-community-btn";
    communityShareBtn.style.cssText = "padding: 12px 30px; font-size: 1.2rem; font-weight: bold; background: rgba(229, 9, 20, 0.2); color: #fff; border: 1px solid #E50914; border-radius: 5px; cursor: pointer; transition: 0.2s;";
    communityShareBtn.innerText = "👥 Share to Community";
    communityShareBtn.onmouseover = () => communityShareBtn.style.background = "#E50914";
    communityShareBtn.onmouseout = () => communityShareBtn.style.background = "rgba(229, 9, 20, 0.2)";
    detailsBtnGroup.appendChild(communityShareBtn);

    const actorModal = document.getElementById('actor-modal');
    const closeActorBtn = document.getElementById('close-actor-btn');
    const actorNameEl = document.getElementById('actor-name');
    const actorBioEl = document.getElementById('actor-bio');
    const actorPhotoEl = document.getElementById('actor-photo');
    const actorMoviesRow = document.getElementById('actor-movies-row');

    closeActorBtn.addEventListener('click', () => { actorModal.style.display = 'none'; });
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

            fetchUserData().then(() => {
                renderPersonalizedRows();
                syncProgressBars();
            });
        } else {
            currentUserUid = null;
            window.currentUserEmail = null;
            continueWatching = [];
            alreadyWatched = [];
            myList = [];
            progressMap = {};
            loginView.style.display = 'flex';
            if (rotationIntervalId) clearInterval(rotationIntervalId);
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authErrorMsg.style.color = "white";
        authErrorMsg.innerText = "Checking credentials...";
        try {
            await signInWithEmailAndPassword(auth, authEmailInput.value, authPasswordInput.value);
            authErrorMsg.innerText = "";
        } catch (error) {
            authErrorMsg.style.color = "#E50914";
            authErrorMsg.innerText = "Incorrect email or password.";
        }
    });

    async function triggerSurprise() {
        mobileMenu.style.right = '-100%';
        try {
            const res = await fetch(`${BASE_URL}/trending/all/week?api_key=${API_KEY}`);
            const data = await res.json();
            const randomItem = data.results[Math.floor(Math.random() * data.results.length)];
            openDetailsModal(randomItem.id, randomItem.media_type === 'tv');
        } catch (e) { }
    }
    document.getElementById('btn-surprise').addEventListener('click', triggerSurprise);
    btnSurpriseMobile.addEventListener('click', triggerSurprise);

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            if (e.target.id === "btn-surprise-mobile" || e.target.id === "btn-logout-mobile") return;
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
            const isCommunityCard = card.getAttribute('data-community-item') === 'true';
            const wasAddedByMe = card.getAttribute('data-added-by-me') === 'true';

            let rawProgress = progressMap[id];
            let savedProgress = null;

            if (rawProgress) {
                if (typeof rawProgress === 'object') {
                    savedProgress = rawProgress.percent;
                } else {
                    savedProgress = rawProgress;
                }
            }

            if (isCommunityCard && !wasAddedByMe) {
                savedProgress = null;
            }

            let track = card.querySelector('.progress-track');

            if (savedProgress) {
                if (!track) {
                    track = document.createElement('div');
                    track.className = 'progress-track';

                    if (card.classList.contains('top-10-wrapper')) {
                        track.style.position = 'absolute';
                        track.style.bottom = '0';
                        track.style.left = '0';
                        track.style.width = '140px';
                        track.style.zIndex = '10';
                        track.style.borderBottomLeftRadius = '5px';
                        track.style.borderBottomRightRadius = '5px';
                    }
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

    function renderSkeletons(container, count = 10, isTop10 = false) {
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const div = document.createElement('div');
            div.className = isTop10 ? 'skeleton-top10' : 'skeleton-card';
            container.appendChild(div);
        }
    }

    async function loadCategoryView(viewType) {
        renderPersonalizedRows();

        const top10Container = document.getElementById('top-10-container');
        const top10Row = document.getElementById('top-10-row');
        const row1 = document.getElementById('trending-row');
        const row2 = document.getElementById('action-row');
        const row3 = document.getElementById('comedy-row');
        const row4 = document.getElementById('series-row');

        const dict = translations[currentLang] || translations.en;

        renderSkeletons(row1); renderSkeletons(row2); renderSkeletons(row3); renderSkeletons(row4);

        try {
            if (viewType === 'home') {
                top10Container.style.display = 'block';
                renderSkeletons(top10Row, 10, true);

                document.getElementById('row1-title').innerText = dict.rowTrending;
                document.getElementById('row2-title').innerText = dict.rowAction;
                document.getElementById('row3-title').innerText = dict.rowComedy;
                document.getElementById('row4-title').innerText = dict.rowSeries;

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

            } else if (viewType === 'animations') {
                top10Container.style.display = 'none';
                document.getElementById('row1-title').innerText = currentLang === 'es' ? "🍿 Top Películas de Animación" : "🍿 Top Animated Movies";
                document.getElementById('row2-title').innerText = currentLang === 'es' ? "🎌 Anime y Series Animadas" : "🎌 Anime & Animated Series";
                document.getElementById('row3-title').innerText = currentLang === 'es' ? "🧸 Animación Familiar" : "🧸 Family Animation";
                document.getElementById('row4-title').innerText = currentLang === 'es' ? "🔥 Lanzamientos Animados" : "🔥 Trending Animated Releases";

                const animMovData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json();
                populateRow(animMovData.results, row1, false);
                setupHero(animMovData.results.slice(0, 5));

                const animTvData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json();
                populateRow(animTvData.results, row2, true);

                const familyAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16,10751&sort_by=popularity.desc`)).json();
                populateRow(familyAnimData.results, row3, false);

                const trendingAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=vote_count.desc`)).json();
                populateRow(trendingAnimData.results, row4, false);

            } else {
                top10Container.style.display = 'none';
                if (viewType === 'tv') {
                    document.getElementById('row1-title').innerText = currentLang === 'es' ? "📺 Top Series de TV" : "📺 Top TV Shows";
                    document.getElementById('row2-title').innerText = currentLang === 'es' ? "🦸‍♂️ TV de Acción" : "🦸‍♂️ Action TV";
                    document.getElementById('row3-title').innerText = currentLang === 'es' ? "😂 TV de Comedia" : "😂 Comedy TV";
                    document.getElementById('row4-title').innerText = currentLang === 'es' ? "🎭 TV de Drama" : "🎭 Drama TV";
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
                    document.getElementById('row1-title').innerText = currentLang === 'es' ? "🎬 Top Películas" : "🎬 Top Movies";
                    document.getElementById('row2-title').innerText = currentLang === 'es' ? "💥 Películas de Acción" : "💥 Action Movies";
                    document.getElementById('row3-title').innerText = currentLang === 'es' ? "😂 Películas de Comedia" : "😂 Comedy Movies";
                    document.getElementById('row4-title').innerText = currentLang === 'es' ? "👻 Películas de Terror" : "👻 Horror Movies";
                    const tData = await (await fetch(`${BASE_URL}/trending/movie/week?api_key=${API_KEY}`)).json();
                    populateRow(tData.results, row1, false);
                    setupHero(tData.results.slice(0, 5));
                    const aData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=28`)).json();
                    populateRow(aData.results, row2, false);
                    const cData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=35`)).json();
                    populateRow(cData.results, row3, false);
                    const hData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=27`)).json();
                    populateRow(hData.results, row4, false);
                }
            }
        } catch (error) { }
        syncProgressBars();
    }

    function renderHeroDots() {
        heroDotsContainer.innerHTML = '';
        trendingMoviesList.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `hero-dot ${idx === currentHeroIndex ? 'active' : ''}`;
            dot.onclick = () => {
                currentHeroIndex = idx;
                updateHeroBillboard(trendingMoviesList[currentHeroIndex]);
                startHeroRotationLoop();
            };
            heroDotsContainer.appendChild(dot);
        });
    }

    function setupHero(results, isTV = false) {
        if (results && results.length > 0) {
            trendingMoviesList = results.map(item => ({ ...item, isTV: isTV }));
            currentHeroIndex = 0;
            updateHeroBillboard(trendingMoviesList[0]);
            startHeroRotationLoop();
        }
    }

    async function renderPersonalizedRows() {
        const myListContainer = document.getElementById('my-list-container');
        const myListRow = document.getElementById('my-list-row');
        const cwContainer = document.getElementById('continue-watching-container');
        const cwRow = document.getElementById('continue-watching-row');
        const awContainer = document.getElementById('already-watched-container');
        const awRow = document.getElementById('already-watched-row');
        const recContainer = document.getElementById('recommended-container');
        const recRow = document.getElementById('recommended-row');
        const communityContainer = document.getElementById('community-container');
        const communityRow = document.getElementById('community-row');

        if (myList.length > 0) {
            myListContainer.style.display = 'block';
            populateRow(myList, myListRow, false);
        } else { myListContainer.style.display = 'none'; }

        if (globalCommunityMovies.length > 0 && communityContainer && communityRow) {
            communityContainer.style.display = 'block';
            communityRow.innerHTML = '';

            globalCommunityMovies.forEach(item => {
                const movieId = item.id || item.movieId || item[0];
                const movieTitle = item.title || item.movieTitle || item.name || item[1];
                const moviePoster = item.poster_path || item.posterPath || item[2];
                const addedByUser = item.addedBy || item.uid || item[3];

                if (!movieId || !moviePoster) return;

                const card = document.createElement('div');
                card.className = 'movie-card';
                card.setAttribute('data-id', movieId.toString());
                card.setAttribute('data-community-item', 'true');
                card.setAttribute('data-added-by-me', (addedByUser === currentUserUid).toString());

                card.innerHTML = `
                    <img src="${IMAGE_BASE_URL}${moviePoster}" alt="${movieTitle}">
                    <div class="card-info">
                        <div class="card-title">${movieTitle}</div>
                        <div class="card-meta"><span style="color:#e50914; font-weight:bold;">👥 Shared Party</span></div>
                    </div>
                `;

                card.addEventListener('click', () => {
                    openDetailsModal(movieId, false);
                });
                communityRow.appendChild(card);
            });
            syncProgressBars();
        } else if (communityContainer) {
            communityContainer.style.display = 'none';
        }

        if (continueWatching.length > 0) {
            cwContainer.style.display = 'block';
            populateRow(continueWatching, cwRow, false);
            const lastWatched = continueWatching[0];
            try {
                const res = await fetch(`${BASE_URL}/${lastWatched.media_type}/${lastWatched.id}/similar?api_key=${API_KEY}`);
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    recContainer.style.display = 'block';
                    const formattedRecs = data.results.map(item => ({ ...item, media_type: lastWatched.media_type }));
                    populateRow(formattedRecs, recRow, lastWatched.media_type === 'tv');
                } else { recContainer.style.display = 'none'; }
            } catch (e) { recContainer.style.display = 'none'; }
        } else {
            cwContainer.style.display = 'none';
            recContainer.style.display = 'none';
        }

        if (alreadyWatched.length > 0) {
            awContainer.style.display = 'block';
            populateRow(alreadyWatched, awRow, false);
        } else { awContainer.style.display = 'none'; }

        syncProgressBars();
    }

    function toggleMyList(data) {
        if (!data || !currentUserUid) return;
        const index = myList.findIndex(item => item.id === data.id);
        if (index > -1) { myList.splice(index, 1); }
        else {
            myList.unshift({ id: data.id, title: data.title || data.name, poster_path: data.poster_path, media_type: data.media_type, release_date: data.release_date || data.first_air_date, vote_average: data.vote_average });
        }
        saveUserData();
        renderPersonalizedRows();
    }

    function addToContinueWatching(data) {
        if (!data || !currentUserUid) return;
        const rawP = progressMap[data.id];
        const isFinished = (rawP && typeof rawP === 'object') ? (rawP.percent === '100') : (rawP === '100');

        if (isFinished) {
            alreadyWatched = alreadyWatched.filter(item => item.id !== data.id);
            alreadyWatched.unshift({ id: data.id, title: data.title || data.name, poster_path: data.poster_path, media_type: data.media_type, release_date: data.release_date || data.first_air_date, vote_average: data.vote_average });
            if (alreadyWatched.length > 15) alreadyWatched.pop();
            continueWatching = continueWatching.filter(item => item.id !== data.id);
        } else {
            continueWatching = continueWatching.filter(item => item.id !== data.id);
            continueWatching.unshift({ id: data.id, title: data.title || data.name, poster_path: data.poster_path, media_type: data.media_type, release_date: data.release_date || data.first_air_date, vote_average: data.vote_average });
            if (continueWatching.length > 10) continueWatching.pop();
            alreadyWatched = alreadyWatched.filter(item => item.id !== data.id);
        }

        saveUserData();
        renderPersonalizedRows();
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

    async function openDetailsModal(id, isTV) {
        try {
            document.querySelector('.details-content').scrollTop = 0;
            clearTimeout(modalTrailerTimeout);
            modalTrailerFrame.src = "";
            modalTrailerFrame.style.display = 'none';

            const type = isTV ? 'tv' : 'movie';
            const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&append_to_response=credits,similar`);
            const data = await res.json();

            data.media_type = type;
            currentModalData = data;

            document.getElementById('details-title').innerText = data.title || data.name;
            document.getElementById('details-desc').innerText = data.overview || "No description available.";
            document.getElementById('details-rating').innerText = `⭐ ${parseFloat(data.vote_average).toFixed(1)} Rating`;

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
            } else { modalSimilarRow.innerHTML = "<p style='color: #aaa;'>No similar shows found.</p>"; }

            let isInList = myList.some(m => m.id === id);
            detailsMylistBtn.innerText = isInList ? "✔️ In My List" : "➕ My List";
            detailsMylistBtn.style.backgroundColor = isInList ? "#46d369" : "rgba(109, 109, 110, 0.7)";

            detailsMylistBtn.onclick = () => {
                toggleMyList(currentModalData);
                isInList = !isInList;
                detailsMylistBtn.innerText = isInList ? "✔️ In My List" : "➕ My List";
                detailsMylistBtn.style.backgroundColor = isInList ? "#46d369" : "rgba(109, 109, 110, 0.7)";
            };

            communityShareBtn.onclick = () => { shareMovieToCommunity(currentModalData); };

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
                } else { alert("Trailer not available for this title."); }
            };

            if (isTV) {
                modalTvControls.style.display = 'flex';
                modalSeasonSelect.innerHTML = '';

                const tvMemory = progressMap[id] && typeof progressMap[id] === 'object' ? progressMap[id] : null;
                const resumeSeason = tvMemory ? tvMemory.lastSeason : 1;
                const resumeEpisode = tvMemory ? tvMemory.lastEpisode : 1;

                const validSeasons = data.seasons.filter(s => s.season_number > 0);
                validSeasons.forEach(s => {
                    const option = document.createElement('option');
                    option.value = s.season_number;
                    option.innerText = `Season ${s.season_number}`;
                    if (parseInt(s.season_number) === parseInt(resumeSeason)) option.selected = true;
                    modalSeasonSelect.appendChild(option);
                });

                if (validSeasons.length > 0) { await populateModalEpisodes(id, modalSeasonSelect.value); }
                if (modalEpisodeSelect.children.length >= resumeEpisode) { modalEpisodeSelect.value = resumeEpisode; }

                modalSeasonSelect.onchange = async (e) => { await populateModalEpisodes(id, e.target.value); };

                detailsPlayBtn.onclick = (e) => {
                    if (e) { e.preventDefault(); e.stopPropagation(); }
                    clearTimeout(modalTrailerTimeout);
                    detailsModal.style.display = 'none';
                    modalTrailerFrame.src = "";
                    try { addToContinueWatching(currentModalData); } catch (err) { }
                    launchVideoStream(id, true, modalSeasonSelect.value, modalEpisodeSelect.value);
                };
            } else {
                modalTvControls.style.display = 'none';

                detailsPlayBtn.onclick = (e) => {
                    if (e) { e.preventDefault(); e.stopPropagation(); }
                    clearTimeout(modalTrailerTimeout);
                    detailsModal.style.display = 'none';
                    modalTrailerFrame.src = "";
                    try { addToContinueWatching(currentModalData); } catch (err) { }
                    launchVideoStream(id, false);
                };
            }
            detailsModal.style.display = 'block';

        } catch (error) { console.error("Failed to load details modal:", error); }
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

    closeDetailsBtn.addEventListener('click', () => {
        clearTimeout(modalTrailerTimeout);
        detailsModal.style.display = 'none';
        modalTrailerFrame.src = "";
    });

    function launchVideoStream(id, isTV = false, season = 1, episode = 1) {
        try {
            currentTvState = { id, isTV, season: parseInt(season), episode: parseInt(episode) };

            window.activeVideoStartTime = Date.now();
            window.rewardClaimedForSession = false;

            if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);

            if (isTV) {
                if (!progressMap[id] || typeof progressMap[id] !== 'object') {
                    progressMap[id] = {};
                }
                progressMap[id].percent = '10';
                progressMap[id].lastSeason = parseInt(season);
                progressMap[id].lastEpisode = parseInt(episode);
                saveUserData();
            } else {
                let savedP = progressMap[id];
                if (!savedP || typeof savedP === 'object') {
                    progressMap[id] = '10';
                    saveUserData();
                }
            }

            requestWakeLock();

            try { heroPlayerFrame.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*'); } catch (e) { }

            if (isTV) {
                btnPrevEp.style.display = currentTvState.episode > 1 ? 'inline-block' : 'none';
                btnNextEp.style.display = 'inline-block';
                episodeIndicatorText.innerText = `Playing: Season ${season}, Episode ${episode}`;
            } else {
                btnPrevEp.style.display = 'none';
                btnNextEp.style.display = 'none';
                episodeIndicatorText.innerText = "Feature Film";
            }

            btnMarkFinished.innerText = "✔️ Mark Finished";

            const activeServer = serverSelect ? serverSelect.value : 'vidsrc';
            const streamUrl = getServerStreamUrl(activeServer, id, isTV, season, episode);

            videoPlayerFrame.removeAttribute('sandbox');
            videoPlayerFrame.src = streamUrl;
            videoModal.style.display = 'block';

            window.watchTimerInterval = setInterval(() => {
                if (!currentUserUid || window.rewardClaimedForSession) return;

                const elapsedMinutes = (Date.now() - window.activeVideoStartTime) / 60000;

                if (!currentTvState.isTV) {
                    if (elapsedMinutes >= 60) {
                        window.rewardClaimedForSession = true;
                        window.userTotalPoints = parseFloat((window.userTotalPoints + 0.25).toFixed(2));
                        progressMap['_points_'] = window.userTotalPoints;
                        progressMap[currentTvState.id] = '100';

                        const mobileMenuPoints = document.getElementById('mobile-menu-points');
                        if (mobileMenuPoints) mobileMenuPoints.innerText = window.userTotalPoints.toFixed(2);

                        saveUserData();
                        showRewardToast("🍿 Reward Earned!", "You earned $0.25 BZD for watching 1 hour!");
                    }
                } else {
                    if (elapsedMinutes >= 40) {
                        window.rewardClaimedForSession = true;

                        if (!progressMap[currentTvState.id] || typeof progressMap[currentTvState.id] !== 'object') {
                            progressMap[currentTvState.id] = {};
                        }
                        if (!Array.isArray(progressMap[currentTvState.id].completedEpisodes)) {
                            progressMap[currentTvState.id].completedEpisodes = [];
                        }

                        const currentEpKey = `S${currentTvState.season}E${currentTvState.episode}`;
                        if (!progressMap[currentTvState.id].completedEpisodes.includes(currentEpKey)) {
                            progressMap[currentTvState.id].completedEpisodes.push(currentEpKey);
                        }

                        let isSeriesFinale = false;
                        let totalShowEpisodes = 0;
                        let maxSeason = 1;
                        let maxEpisode = 1;

                        if (currentModalData && currentModalData.seasons) {
                            const validSeasons = currentModalData.seasons.filter(s => s.season_number > 0);
                            maxSeason = Math.max(...validSeasons.map(s => s.season_number));
                            validSeasons.forEach(s => { totalShowEpisodes += (s.episode_count || 0); });
                            const targetSeasonObj = validSeasons.find(s => s.season_number === maxSeason);
                            maxEpisode = targetSeasonObj ? targetSeasonObj.episode_count : 1;

                            if (currentTvState.season === maxSeason && currentTvState.episode === maxEpisode) {
                                isSeriesFinale = true;
                            }
                        }

                        const watchedCount = progressMap[currentTvState.id].completedEpisodes.length;
                        const requiredEpisodes = Math.max(1, Math.floor(totalShowEpisodes * 0.8));

                        if (isSeriesFinale && watchedCount >= requiredEpisodes) {
                            window.userTotalPoints = parseFloat((window.userTotalPoints + 1.00).toFixed(2));
                            progressMap['_points_'] = window.userTotalPoints;
                            progressMap[currentTvState.id].percent = '100';

                            const mobileMenuPoints = document.getElementById('mobile-menu-points');
                            if (mobileMenuPoints) mobileMenuPoints.innerText = window.userTotalPoints.toFixed(2);

                            showRewardToast("🎉 Series Complete!", "You earned $1.00 BZD!");
                        } else {
                            showRewardToast("✔️ Episode Recorded!", `Progress saved! (${watchedCount}/${totalShowEpisodes} Watched)`);
                        }

                        saveUserData();
                    }
                }
            }, 10000);

        } catch (fatalError) {
            console.error("Launch Video Stream crashed:", fatalError);
        }
    }

    if (serverSelect) {
        serverSelect.addEventListener('change', (e) => {
            if (currentTvState.id) {
                const newServerKey = e.target.value;
                const newStreamUrl = getServerStreamUrl(
                    newServerKey,
                    currentTvState.id,
                    currentTvState.isTV,
                    currentTvState.season,
                    currentTvState.episode
                );

                videoPlayerFrame.removeAttribute('sandbox');
                videoPlayerFrame.src = newStreamUrl;
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

            const elapsedMinutes = (Date.now() - window.activeVideoStartTime) / 60000;
            let earnedPoints = 0;
            let btnFeedback = "";

            if (!currentTvState.isTV) {
                progressMap[currentTvState.id] = '100';

                if (elapsedMinutes >= 60) {
                    earnedPoints = 0.25;
                    btnFeedback = "⭐ +$0.25 BZD Earned!";
                } else {
                    btnFeedback = "✔️ Saved (Watch 1 hour for $0.25 BZD!)";
                }
            } else {
                if (!progressMap[currentTvState.id] || typeof progressMap[currentTvState.id] !== 'object') {
                    progressMap[currentTvState.id] = {};
                }
                if (!Array.isArray(progressMap[currentTvState.id].completedEpisodes)) {
                    progressMap[currentTvState.id].completedEpisodes = [];
                }

                const currentEpKey = `S${currentTvState.season}E${currentTvState.episode}`;

                if (elapsedMinutes >= 40) {
                    if (!progressMap[currentTvState.id].completedEpisodes.includes(currentEpKey)) {
                        progressMap[currentTvState.id].completedEpisodes.push(currentEpKey);
                    }
                }

                let isSeriesFinale = false;
                let totalShowEpisodes = 0;
                let maxSeason = 1;
                let maxEpisode = 1;

                if (currentModalData && currentModalData.seasons) {
                    const validSeasons = currentModalData.seasons.filter(s => s.season_number > 0);
                    maxSeason = Math.max(...validSeasons.map(s => s.season_number));
                    validSeasons.forEach(s => { totalShowEpisodes += (s.episode_count || 0); });
                    const targetSeasonObj = validSeasons.find(s => s.season_number === maxSeason);
                    maxEpisode = targetSeasonObj ? targetSeasonObj.episode_count : 1;

                    if (currentTvState.season === maxSeason && currentTvState.episode === maxEpisode) {
                        isSeriesFinale = true;
                    }
                }

                const watchedCount = progressMap[currentTvState.id].completedEpisodes.length;
                const requiredEpisodes = Math.max(1, Math.floor(totalShowEpisodes * 0.8));

                if (isSeriesFinale && elapsedMinutes >= 40 && watchedCount >= requiredEpisodes) {
                    earnedPoints = 1.00;
                    progressMap[currentTvState.id].percent = '100';
                    btnFeedback = "⭐ Series Complete! +$1.00 BZD Earned!";
                } else if (isSeriesFinale && elapsedMinutes >= 40 && watchedCount < requiredEpisodes) {
                    btnFeedback = `🚫 Watch ${requiredEpisodes - watchedCount} more episodes to unlock $1.00!`;
                } else if (!isSeriesFinale && elapsedMinutes >= 40) {
                    btnFeedback = `✔️ Ep Saved! (${watchedCount}/${totalShowEpisodes} Watched)`;
                } else {
                    btnFeedback = "✔️ Saved (Watch 40m to record episode!)";
                }
            }

            if (earnedPoints > 0) {
                window.userTotalPoints = parseFloat((window.userTotalPoints + earnedPoints).toFixed(2));
                progressMap['_points_'] = window.userTotalPoints;

                const mobileMenuPoints = document.getElementById('mobile-menu-points');
                if (mobileMenuPoints) {
                    mobileMenuPoints.innerText = window.userTotalPoints.toFixed(2);
                }
            }

            btnMarkFinished.innerText = btnFeedback;

            continueWatching = continueWatching.filter(item => item.id !== currentTvState.id);

            if (currentModalData) {
                alreadyWatched = alreadyWatched.filter(item => item.id !== currentModalData.id);
                alreadyWatched.unshift({
                    id: currentModalData.id,
                    title: currentModalData.title || currentModalData.name,
                    poster_path: currentModalData.poster_path,
                    media_type: currentModalData.media_type,
                    release_date: currentModalData.release_date || currentModalData.first_air_date,
                    vote_average: currentModalData.vote_average
                });
                if (alreadyWatched.length > 15) alreadyWatched.pop();
            }

            saveUserData();
            setTimeout(() => { btnMarkFinished.innerText = "✔️ Mark Finished"; }, 4000);
            syncProgressBars();
        }
    });

    closeModalBtn.addEventListener('click', () => {
        if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);
        videoModal.style.display = 'none';
        videoPlayerFrame.src = "";
        releaseWakeLock();
        renderPersonalizedRows();
        try { heroPlayerFrame.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*'); } catch (e) { }
    });

    heroMuteBtn.addEventListener('click', () => {
        isHeroMuted = !isHeroMuted;
        heroMuteBtn.innerText = isHeroMuted ? "🔇" : "🔊";
        const command = isHeroMuted ? 'mute' : 'unMute';
        heroPlayerFrame.contentWindow.postMessage(`{"event":"command","func":"${command}","args":""}`, '*');
    });

    async function fetchMovieTrailer(movieId, isTV = false) {
        try {
            const type = isTV ? 'tv' : 'movie';
            const res = await fetch(`${BASE_URL}/${type}/${movieId}/videos?api_key=${API_KEY}`);
            const data = await res.json();
            const trailer = data.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
            return trailer ? trailer.key : null;
        } catch (error) { return null; }
    }

    function startHeroRotationLoop() {
        if (rotationIntervalId) clearInterval(rotationIntervalId);
        rotationIntervalId = setInterval(async () => {
            if (trendingMoviesList.length === 0) return;
            currentHeroIndex = (currentHeroIndex + 1) % trendingMoviesList.length;
            await updateHeroBillboard(trendingMoviesList[currentHeroIndex]);
        }, 30000);
    }

    async function updateHeroBillboard(featuredMovie) {
        if (!featuredMovie) return;
        renderHeroDots();
        const type = featuredMovie.isTV ? 'tv' : 'movie';
        try {
            const imgRes = await fetch(`${BASE_URL}/${type}/${featuredMovie.id}/images?api_key=${API_KEY}`);
            const imgData = await imgRes.json();
            const enLogo = imgData.logos ? imgData.logos.find(l => l.iso_639_1 === 'en') : null;
            const logoToUse = enLogo || (imgData.logos && imgData.logos.length > 0 ? imgData.logos[0] : null);

            if (logoToUse) {
                heroDisplayTitle.style.display = 'none';
                heroDisplayLogo.style.display = 'block';
                heroDisplayLogo.src = `https://image.tmdb.org/t/p/w500${logoToUse.file_path}`;
            } else {
                heroDisplayLogo.style.display = 'none';
                heroDisplayTitle.style.display = 'block';
                heroDisplayTitle.innerText = (featuredMovie.title || featuredMovie.name).toUpperCase();
            }
        } catch (e) {
            heroDisplayLogo.style.display = 'none';
            heroDisplayTitle.style.display = 'block';
            heroDisplayTitle.innerText = (featuredMovie.title || featuredMovie.name).toUpperCase();
        }

        heroDisplayDesc.innerText = featuredMovie.overview || "No description available at this moment.";
        heroPosterBg.style.backgroundImage = `url('${HERO_IMAGE_BASE_URL}${featuredMovie.backdrop_path}')`;

        heroPlayBtn.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            openDetailsModal(featuredMovie.id, featuredMovie.isTV);
        };

        const trailerKey = await fetchMovieTrailer(featuredMovie.id, featuredMovie.isTV);
        if (trailerKey) {
            heroPlayerFrame.style.display = 'block';
            heroMuteBtn.style.display = 'flex';
            heroPlayerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerKey}&showinfo=0&rel=0&modestbranding=1&enablejsapi=1`;
            isHeroMuted = true;
            heroMuteBtn.innerText = "🔇";
        } else {
            heroPlayerFrame.src = "";
            heroPlayerFrame.style.display = 'none';
            heroMuteBtn.style.display = 'none';
        }
    }

    function populateTop10Row(movies, container) {
        if (!container) return;
        container.innerHTML = '';
        movies.forEach((item, index) => {
            if (!item.poster_path) return;
            const isTV = item.media_type === 'tv';
            const card = document.createElement('div');
            card.className = 'top-10-wrapper';
            card.setAttribute('data-id', item.id);

            card.innerHTML = `
                <span class="top-10-number">${index + 1}</span>
                <img src="${IMAGE_BASE_URL}${item.poster_path}" alt="${item.title || item.name}" class="top-10-poster">
            `;
            card.addEventListener('click', () => openDetailsModal(item.id, isTV));
            container.appendChild(card);
        });
        syncProgressBars();
    }

    function populateRow(movies, container, isTV = false) {
        if (!container) return;
        container.innerHTML = '';
        movies.forEach(item => {
            if (!item.poster_path) return;
            const isTvItem = item.media_type === 'tv' || isTV;
            const card = createMovieCard(item, isTvItem);
            container.appendChild(card);
        });
        syncProgressBars();
    }

    async function fetchLiveSearch(query) {
        if (query.trim().length < 2) {
            searchDropdown.style.display = 'none';
            return;
        }
        try {
            const response = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&query=${query}`);
            const data = await response.json();

            searchDropdown.innerHTML = '';
            const validResults = data.results.filter(i => i.poster_path).slice(0, 8);

            if (validResults.length === 0) {
                searchDropdown.innerHTML = '<div style="padding: 10px; color: #aaa; text-align: center;">No results found</div>';
            } else {
                validResults.forEach(item => {
                    const isTV = (item.media_type === 'tv');
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    const year = (item.release_date || item.first_air_date || "N/A").substring(0, 4);
                    div.innerHTML = `
                        <img src="${IMAGE_BASE_URL}${item.poster_path}" alt="">
                        <div class="search-item-info">
                            <span class="search-item-title">${item.title || item.name}</span>
                            <span class="search-item-meta">${isTV ? 'TV Series' : 'Movie'} • ${year}</span>
                        </div>
                    `;
                    div.onclick = () => {
                        searchDropdown.style.display = 'none';
                        searchInput.value = '';
                        openDetailsModal(item.id, isTV);
                    };
                    searchDropdown.appendChild(div);
                });
            }
            searchDropdown.style.display = 'block';
        } catch (error) { }
    }

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { fetchLiveSearch(e.target.value); }, 400);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== searchInput && e.target !== searchDropdown) {
            searchDropdown.style.display = 'none';
        }
    });

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

        card.addEventListener('click', () => {
            openDetailsModal(item.id, isTV);
        });

        return card;
    }

    document.querySelectorAll('.brand-logo, #btn-home').forEach(btn => {
        btn.addEventListener('click', () => {
            searchInput.value = '';
            loadCategoryView('home');
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.querySelector('[data-view="home"]').classList.add('active');
        });
    });

    async function checkSessionLock() {
        if (!currentUserUid || !dataLoadedFromCloud || window.isKickedOut || window.takeoverImmunity) return;

        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST",
                body: JSON.stringify({ action: "fetch", uid: currentUserUid, cacheBust: Date.now() })
            });
            const result = await response.json();

            if (result.exists) {
                const currentCloudDevice = (result.data.progress || {})['_active_device_'];

                if (currentCloudDevice && currentCloudDevice !== myDeviceId) {

                    window.isKickedOut = true;

                    document.body.innerHTML = `
                        <div style="background:#000; color:#fff; position:fixed; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:999999; text-align:center; padding:20px; font-family:sans-serif;">
                            <h1 style="color:#e50914; margin-bottom: 15px;">🚫 SESSION TERMINATED</h1>
                            <p style="font-size: 1.1rem; line-height: 1.5;">The account owner just logged in on another device.<br>You have been kicked out.</p>
                        </div>
                    `;

                    setTimeout(() => {
                        firebase.auth().signOut().then(() => {
                            window.location.reload();
                        });
                    }, 4000);
                }
            }
        } catch (e) { }
    }

    setInterval(checkSessionLock, 10000);
    window.addEventListener('focus', checkSessionLock);
    window.addEventListener('click', () => {
        if (!window.lockCheckThrottled) {
            window.lockCheckThrottled = true;
            checkSessionLock();
            setTimeout(() => { window.lockCheckThrottled = false; }, 10000);
        }
    });

});
