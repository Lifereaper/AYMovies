import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut, 
    sendPasswordResetEmail, 
    deleteUser,
    setPersistence,
    browserLocalPersistence 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

// Force Firebase to lock auth state to LOCAL device storage
setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error("Auth persistence error:", err);
});

const db = initializeFirestore(firebaseApp, {
    experimentalForceLongPolling: true
});

let wakeLock = null;
const noSleepFallback = new window.NoSleep();

async function requestWakeLock() {
    try {
        noSleepFallback.enable(); 
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) { console.error("Wake Lock failed:", err); }
}

function releaseWakeLock() {
    noSleepFallback.disable(); 
    if (wakeLock !== null) {
        wakeLock.release().then(() => wakeLock = null);
    }
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
    const splashDmcaView = document.getElementById('splash-dmca-view');
    const btnAcceptDmca = document.getElementById('btn-accept-dmca');

    if (!localStorage.getItem('ay_dmca_accepted')) {
        splashDmcaView.style.display = 'flex';
    }

    if (btnAcceptDmca) {
        btnAcceptDmca.addEventListener('click', () => {
            localStorage.setItem('ay_dmca_accepted', 'true');
            splashDmcaView.style.opacity = '0';
            setTimeout(() => { splashDmcaView.style.display = 'none'; }, 300);
        });
    }
    
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
    let globalReactionsMap = {};

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
    
    let localProgressTrackerInterval = null;
    let loadingBannerTimer = null;
    
    const LOCAL_API_URL = "https://twilight-mud-4868.yalex6677.workers.dev/api/progress";
    const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbxwF2aEerT5-myiVMhB6iXd50_iF0m8-GAAAZ18vA5Livbu7V6UDU810WCwhHJ7wOc/exec";

    function startLocalProgressTracker(videoElement, trackingId) {
        if (localProgressTrackerInterval) clearInterval(localProgressTrackerInterval);
        localProgressTrackerInterval = setInterval(() => {
            if (!videoElement.paused && videoElement.currentTime > 0 && videoElement.duration) {
                fetch(LOCAL_API_URL, { 
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        movieId: trackingId.toString(),
                        currentTime: videoElement.currentTime,
                        duration: videoElement.duration
                    })
                }).catch(err => console.log('Local sync error:', err));
            }
        }, 10000); 
    }

    async function checkAndResumeLocalVideo(videoElement, trackingId) {
        try {
            const response = await fetch(LOCAL_API_URL);
            const history = await response.json();
            if (history[trackingId]) {
                videoElement.currentTime = history[trackingId].currentTime;
            }
        } catch (error) {
            console.error('Could not load local history:', error);
        }
    }

    async function syncLocalProgressBars() {
        try {
            const historyResponse = await fetch(LOCAL_API_URL);
            const watchHistory = await historyResponse.json();

            const cards = document.querySelectorAll('.movie-card, .top-10-wrapper');
            cards.forEach(card => {
                const id = card.getAttribute('data-id');
                let trackingId = id;
                
                if (progressMap[id] && progressMap[id].lastSeason) {
                    trackingId = `${id}-S${progressMap[id].lastSeason}E${progressMap[id].lastEpisode}`;
                }
                
                const historyData = watchHistory[trackingId] || watchHistory[id];

                if (historyData) {
                    const savedTime = historyData.currentTime;
                    const totalTime = historyData.duration;
                    
                    let percentage = (savedTime / totalTime) * 100;
                    if (percentage > 100) percentage = 100; 

                    let track = card.querySelector('.local-progress-track');
                    if (!track) {
                        track = document.createElement('div');
                        track.className = 'local-progress-track';
                        track.style.cssText = 'width: 100%; height: 5px; background-color: rgba(255,255,255,0.2); position: absolute; bottom: 0; left: 0; z-index: 20; border-bottom-left-radius: 5px; border-bottom-right-radius: 5px; overflow: hidden;';
                        
                        const fill = document.createElement('div');
                        fill.className = 'local-progress-fill';
                        fill.style.cssText = 'height: 100%; background-color: #E50914; transition: width 0.3s ease;';
                        
                        track.appendChild(fill);
                        card.appendChild(track);
                        card.style.position = 'relative'; 
                    }
                    
                    const fill = track.querySelector('.local-progress-fill');
                    fill.style.width = `${percentage}%`;
                }
            });
        } catch (e) {}
    }

    function showCustomAlert(message) {
        const alertModal = document.getElementById('custom-alert-modal');
        const alertMsg = document.getElementById('alert-message');
        const alertOkBtn = document.getElementById('alert-ok-btn');
        if (!alertModal) return alert(message);
        alertMsg.innerText = message;
        alertModal.style.display = "flex";
        alertOkBtn.onclick = () => { alertModal.style.display = "none"; };
    }

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
        if (rewardsDrawer) rewardsDrawer.style.right = '0';
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
                setTimeout(() => { payoutStatusMsg.innerText = ''; }, 3000);
                return;
            }
            if (amount > window.userTotalPoints) {
                payoutStatusMsg.style.color = '#E50914';
                payoutStatusMsg.innerText = '⚠️ Insufficient balance!';
                setTimeout(() => { payoutStatusMsg.innerText = ''; }, 3000);
                return;
            }

            payoutStatusMsg.style.color = '#ffd700';
            payoutStatusMsg.innerText = '⏳ Submitting request...';

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
                    payoutStatusMsg.innerText = `✅ Request submitted! $${amount.toFixed(2)} BZD sent.`;
                    payoutForm.reset();
                    setTimeout(async () => {
                        await fetchUserData();
                        payoutStatusMsg.innerText = '';
                    }, 3000);
                } else {
                    payoutStatusMsg.style.color = '#E50914';
                    payoutStatusMsg.innerText = '❌ Failed to process request. Try again later.';
                    setTimeout(() => { payoutStatusMsg.innerText = ''; }, 3000);
                }
            } catch (err) {
                payoutStatusMsg.style.color = '#E50914';
                payoutStatusMsg.innerText = '❌ Network error during submission.';
                setTimeout(() => { payoutStatusMsg.innerText = ''; }, 3000);
            }
        });
    }

    document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const filterType = e.target.getAttribute('data-filter');
            applyMoodFilter(filterType);
        });
    });

    function applyMoodFilter(filter) {
        const allCards = document.querySelectorAll('.movie-card, .top-10-wrapper');
        const allRows = document.querySelectorAll('.row-container'); 

        if (filter === 'all') {
            allCards.forEach(c => c.style.display = 'block');
            allRows.forEach(r => r.style.display = 'block');
            const activeView = document.querySelector('.nav-link.active')?.getAttribute('data-view') || 'home';
            const top10Container = document.getElementById('top-10-container');
            if (top10Container) top10Container.style.display = (activeView === 'home') ? 'block' : 'none';
            renderPersonalizedRows(); 
            return;
        }

        allCards.forEach(c => c.style.display = 'block');
        if (filter === 'action' || filter === 'comedy' || filter === 'series') {
            allRows.forEach(row => {
                const rowTitle = (row.querySelector('.row-title')?.innerText || '').toLowerCase();
                const innerRowId = (row.querySelector('.movie-row')?.id || row.id || '').toLowerCase();
                if (rowTitle.includes(filter) || innerRowId.includes(filter)) {
                    row.style.display = 'block'; 
                } else {
                    row.style.display = 'none';  
                }
            });
        } else {
            allCards.forEach(card => {
                const cardMeta = card.querySelector('.card-meta')?.innerText || '';
                let isMatch = false;
                if (filter === 'top-rated' && cardMeta.includes('⭐')) {
                    const score = parseFloat(cardMeta.split('⭐')[1]) || 0;
                    if (score >= 8.0) isMatch = true;
                } else if (filter === '2026' && (cardMeta.includes('2026') || cardMeta.includes('2025'))) {
                    isMatch = true;
                }
                card.style.display = isMatch ? 'block' : 'none';
            });
            allRows.forEach(row => {
                const cardsInRow = Array.from(row.querySelectorAll('.movie-card, .top-10-wrapper'));
                if (cardsInRow.length > 0) {
                    const hasVisibleCards = cardsInRow.some(card => card.style.display === 'block');
                    row.style.display = hasVisibleCards ? 'block' : 'none';
                }
            });
        }
    }
    
    const translations = {
        en: {
            navHome: "Home", navTv: "TV Shows", navMovies: "Movies", navAnimations: "Animations",
            navSurprise: "🎲 Surprise Me", navLogout: "Logout", searchPlaceholder: "Search...",
            rowMyList: "➕ My List", rowContinue: "🍿 Continue Watching", rowWatchAgain: "🔁 Watch It Again",
            rowRecommended: "💡 Recommended For You", rowTop10: "🏆 Top 10 Today",
            rowCommunity: "👥 Shared Watch Party Community", rowTrending: "🔥 Trending Now",
            rowAction: "💥 Action Movies", rowComedy: "😂 Comedy Movies", rowSeries: "📺 Trending Series",
            
            loginTitle: "Sign In", emailPlaceholder: "Email or phone number", passwordPlaceholder: "Password",
            loginBtn: "Sign In", forgotPassword: "Forgot password?", newToApp: "New to AYMovies?", signupNow: "Sign up now.",
            
            playBtn: "▶ Play", trailerBtn: "🎬 Trailer", myListAdd: "➕ My List", myListAdded: "✔️ In My List",
            shareCommunityBtn: "👥 Share to Community", castLabel: "Cast:", similarLabel: "More Like This",
            
            rewardsTitle: "💰 Rewards Wallet", balanceLabel: "Available Balance:", payoutHeader: "Request DigiWallet Payout",
            methodLabel: "Payout Method", accountLabel: "DigiWallet Number / Account", amountLabel: "Amount (Min $5.00 BZD)",
            requestBtn: "Request Payout", minNotice: "Minimum payout is $5.00 BZD",
            
            referralTitle: "👥 Invite a Friend", refEmailPlaceholder: "Friend's Email", refPhonePlaceholder: "Friend's Phone",
            sendRefBtn: "Send WhatsApp Invite", logoutBtn: "🚪 Logout", deleteAccBtn: "⚠️ Delete Account",
            
            loadingStream: "Fetching Stream...", watchEarn: "🍿 Watch & Earn Money!", movieStartSoon: "Your movie will start soon",
            playingLabel: "Playing: Season", episodeLabel: "Episode"
        },
        es: {
            navHome: "Inicio", navTv: "Series TV", navMovies: "Películas", navAnimations: "Animación",
            navSurprise: "🎲 Sorpréndeme", navLogout: "Cerrar sesión", searchPlaceholder: "Buscar...",
            rowMyList: "Mi Lista", rowContinue: "🍿 Continuar Viendo", rowWatchAgain: "Volver a Ver",
            rowRecommended: "💡 Recomendado para Ti", rowTop10: "🏆 Top 10 Hoy",
            rowCommunity: "👥 Comunidad Watch Party", rowTrending: "🔥 Tendencias Ahora",
            rowAction: "💥 Películas de Acción", rowComedy: "😂 Películas de Comedia", rowSeries: "📺 Series en Tendencia",
            
            loginTitle: "Iniciar sesión", emailPlaceholder: "Correo electrónico o número de teléfono", passwordPlaceholder: "Contraseña",
            loginBtn: "Iniciar sesión", forgotPassword: "¿Olvidaste tu contraseña?", newToApp: "¿Nuevo en AYMovies?", signupNow: "Suscríbete ahora.",
            
            playBtn: "▶ Reproducir", trailerBtn: "🎬 Tráiler", myListAdd: "➕ Mi Lista", myListAdded: "✔️ En Mi Lista",
            shareCommunityBtn: "👥 Compartir a la Comunidad", castLabel: "Reparto:", similarLabel: "Más títulos similares",
            
            rewardsTitle: "💰 Billetera de Recompensas", balanceLabel: "Saldo disponible:", payoutHeader: "Solicitar Pago de DigiWallet",
            methodLabel: "Método de Pago", accountLabel: "Número / Cuenta de DigiWallet", amountLabel: "Monto (Mín. $5.00 BZD)",
            requestBtn: "Solicitar Pago", minNotice: "El pago mínimo es de $5.00 BZD",
            
            referralTitle: "👥 Invitar a un Amigo", refEmailPlaceholder: "Correo del amigo", refPhonePlaceholder: "Teléfono del amigo",
            sendRefBtn: "Enviar Invitación por WhatsApp", logoutBtn: "🚪 Cerrar Sesión", deleteAccBtn: "⚠️ Eliminar Cuenta",
            
            loadingStream: "Cargando...", watchEarn: "🍿 ¡Mira y Gana Dinero!", movieStartSoon: "Tu película comenzará pronto",
            playingLabel: "Reproduciendo: Temporada", episodeLabel: "Episodio"
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
        
        const emailInp = document.getElementById('auth-email');
        if (emailInp) emailInp.placeholder = dict.emailPlaceholder;
        
        const passInp = document.getElementById('auth-password');
        if (passInp) passInp.placeholder = dict.passwordPlaceholder;

        const loginBtn = document.querySelector('#auth-form button[type="submit"]');
        if (loginBtn) loginBtn.innerText = dict.loginBtn;

        const detailsPlay = document.getElementById('details-play-btn');
        if (detailsPlay) detailsPlay.innerHTML = dict.playBtn;

        const detailsTrailer = document.getElementById('details-trailer-btn');
        if (detailsTrailer) detailsTrailer.innerHTML = dict.trailerBtn;

        const detailsShare = document.getElementById('details-community-btn');
        if (detailsShare) detailsShare.innerText = dict.shareCommunityBtn;

        const detailsMylistBtn = document.getElementById('details-mylist-btn');
        if(detailsMylistBtn) {
           if(detailsMylistBtn.innerText.includes('✔️')) {
               detailsMylistBtn.innerText = dict.myListAdded;
           } else {
               detailsMylistBtn.innerText = dict.myListAdd;
           }
        }

        const rowTitles = {
            'row1-title': dict.rowTrending, 'row2-title': dict.rowAction,
            'row3-title': dict.rowComedy, 'row4-title': dict.rowSeries
        };
        for (const [id, titleText] of Object.entries(rowTitles)) {
            const titleEl = document.getElementById(id);
            if (titleEl) titleEl.innerText = titleText;
        }

        const selectors = [
            ['#my-list-container .row-title', dict.rowMyList],
            ['#continue-watching-container .row-title', dict.rowContinue],
            ['#already-watched-container .row-title', dict.rowWatchAgain],
            ['#recommended-container .row-title', dict.rowRecommended],
            ['#top-10-container .row-title', dict.rowTop10],
            ['#community-container .row-title', dict.rowCommunity]
        ];
        selectors.forEach(([sel, text]) => {
            const el = document.querySelector(sel);
            if (el) el.innerText = text;
        });
    }

    ['lang-select', 'lang-select-mobile'].forEach(selectId => {
        const el = document.getElementById(selectId);
        if (el) el.addEventListener('change', (e) => setAppLanguage(e.target.value));
    });

    setAppLanguage(currentLang);

    function showRewardToast(title, message) {
        let toast = document.getElementById('reward-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'reward-toast';
            
            const videoModal = document.getElementById('video-modal') || document.body;
            videoModal.appendChild(toast);
        }

        toast.style.cssText = `
            position: fixed; top: 20%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(15, 15, 15, 0.95); border: 3px solid #ffd700; box-shadow: 0 0 35px rgba(255, 215, 0, 0.9);
            color: white; padding: 20px 40px; border-radius: 12px; z-index: 2147483647; text-align: center;
            font-family: Arial, sans-serif; pointer-events: none; transition: opacity 0.4s ease-in-out;
        `;

        toast.innerHTML = `<div style="font-size: 1.6rem; font-weight: bold; color: #ffd700; margin-bottom: 6px;">${title}</div>
            <div style="font-size: 1.1rem; color: #ffffff;">${message}</div>`;
        toast.style.opacity = '1';
        toast.style.display = 'block';

        setTimeout(() => {
            if (toast) { 
                toast.style.opacity = '0'; 
                setTimeout(() => { toast.style.display = 'none'; }, 400); 
            }
        }, 3000);
    }

    const profileIcon = document.getElementById('profile-icon');
    const avatarDropdown = document.getElementById('avatar-dropdown');
    const customAvatars = ['👤', '🔴', '🔵', '🟢', '👾', '🐧', '😎', '🍿', '👻', '👑', '👽', '🤖', '🦊', '🐯', '🍕', '🎬', '🎮', '🔥', '💎', '🚀', '🐼', '🐉', '🎸', '🌮'];

    profileIcon.addEventListener('click', () => { avatarDropdown.style.display = avatarDropdown.style.display === 'flex' ? 'none' : 'flex'; });

    customAvatars.forEach(av => {
        const span = document.createElement('span');
        span.innerText = av;
        span.style.cssText = "font-size: 1.8rem; cursor: pointer; transition: transform 0.2s;";
        span.className = "tv-focusable";
        span.setAttribute('tabindex', '0');
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

    const searchInput = document.getElementById('search-input');
    const searchDropdown = document.getElementById('search-dropdown');
    const videoModal = document.getElementById('video-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const episodeIndicatorText = document.getElementById('episode-indicator-text');
    const serverSelect = document.getElementById('server-select'); 

    const btnToggleMiniPlayer = document.getElementById('btn-toggle-mini-player');
    if (btnToggleMiniPlayer) {
        btnToggleMiniPlayer.addEventListener('click', () => {
            const isMini = videoModal.classList.toggle('mini-mode');
            btnToggleMiniPlayer.innerText = isMini ? "🔲 Expand" : "🔽 Mini";
        });
    }

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

    async function fetchUserData() {
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST", mode: "cors", redirect: "follow",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
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
                        overlay.innerHTML = `<h1 style="color:#e50914; margin-bottom: 15px;">🚫 ACCESS DENIED</h1><p>Logging out...</p>`;
                        document.body.appendChild(overlay);
                        setTimeout(() => { signOut(auth).then(() => { window.location.reload(); }).catch(() => { window.location.reload(); }); }, 2000);
                        return;
                    }
                }

                profileIcon.innerText = data.avatar || '👤';
                myList = data.myList || [];
                continueWatching = data.continueWatching || [];
                alreadyWatched = data.alreadyWatched || [];
                window.userTotalPoints = parseFloat(progressMap['_points_']) || 0.00;
                updatePointsUI();

                const mobileMenuAvatar = document.getElementById('mobile-menu-avatar');
                const mobileMenuEmail = document.getElementById('mobile-menu-email');
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
            globalReactionsMap = result.reactionsMap || {};

            const trackerCard = document.getElementById('payout-tracker-card');
            const trackerAmount = document.getElementById('payout-tracker-amount');
            const trackerStatus = document.getElementById('payout-tracker-status');
            if (result.latestPayout && trackerCard) {
                trackerCard.style.display = 'block';
                trackerAmount.innerText = `$${parseFloat(result.latestPayout.amount || 0).toFixed(2)} BZD`;
                const statusText = String(result.latestPayout.status || 'Pending').trim();
                
                if (statusText.toLowerCase() === 'paid' || statusText.toLowerCase() === 'completed') {
                    trackerStatus.innerText = '✅ Paid'; trackerStatus.style.color = '#46d369';
                    trackerStatus.style.background = 'rgba(70, 211, 105, 0.2)'; trackerCard.style.borderLeftColor = '#46d369';
                } else if (statusText.toLowerCase() === 'rejected' || statusText.toLowerCase() === 'cancelled') {
                    trackerStatus.innerText = '❌ Rejected'; trackerStatus.style.color = '#E50914';
                    trackerStatus.style.background = 'rgba(229, 9, 20, 0.2)'; trackerCard.style.borderLeftColor = '#E50914';
                } else {
                    trackerStatus.innerText = '⏳ Pending'; trackerStatus.style.color = '#ffd700';
                    trackerStatus.style.background = 'rgba(255, 215, 0, 0.2)'; trackerCard.style.borderLeftColor = '#ffd700';
                }
            } else if (trackerCard) { trackerCard.style.display = 'none'; }
        } catch (e) { }
    }

    async function saveUserData() {
        if (window.isKickedOut || !currentUserUid || !dataLoadedFromCloud) return;
        progressMap['_active_device_'] = myDeviceId;
        const payload = {
            action: "save", uid: currentUserUid, email: window.currentUserEmail,
            userData: { avatar: profileIcon.innerText, myList: myList, continueWatching: continueWatching, alreadyWatched: alreadyWatched, progress: progressMap }
        };
        try { fetch(GOOGLE_SHEET_URL, { method: "POST", mode: "cors", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) }); } catch (e) { }
    }

    async function shareMovieToCommunity(movieObj) {
        if (!currentUserUid || !movieObj) return;
        const payload = {
            action: "addCommunity", uid: currentUserUid,
            movieData: { id: movieObj.id, title: movieObj.title || movieObj.name, poster_path: movieObj.poster_path }
        };
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST", mode: "cors", redirect: "follow",
                headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload)
            });
            if (response.ok) {
                showCustomAlert(`"${movieObj.title || movieObj.name}" was shared directly to the Community Watch list!`);
                await fetchUserData(); renderPersonalizedRows();
            }
        } catch (e) { }
    }

    function initializeFreshProfile() {
        profileIcon.innerText = '👤'; myList = []; continueWatching = []; alreadyWatched = []; progressMap = {}; window.userTotalPoints = 0.00;
        updatePointsUI();
        const mobileMenuAvatar = document.getElementById('mobile-menu-avatar');
        const mobileMenuEmail = document.getElementById('mobile-menu-email');
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
    const actorModal = document.getElementById('actor-modal');
    const closeActorBtn = document.getElementById('close-actor-btn');
    const actorNameEl = document.getElementById('actor-name');
    const actorBioEl = document.getElementById('actor-bio');
    const actorPhotoEl = document.getElementById('actor-photo');
    const actorMoviesRow = document.getElementById('actor-movies-row');

    if (closeActorBtn) closeActorBtn.addEventListener('click', () => { actorModal.style.display = 'none'; });
    mobileMenuBtn.addEventListener('click', () => { mobileMenu.style.right = '0'; });
    closeMobileMenu.addEventListener('click', () => { mobileMenu.style.right = '-100%'; });

    function handleLogout() { mobileMenu.style.right = '-100%'; signOut(auth); }
    btnLogout.addEventListener('click', handleLogout);
    btnLogoutMobile.addEventListener('click', handleLogout);

    // CLEAN AUTH STATE SWITCHER
    onAuthStateChanged(auth, (user) => {
        if (user) {
            if (currentUserUid !== user.uid) {
                continueWatching = [];
                alreadyWatched = [];
                myList = [];
                progressMap = {};
                window.userTotalPoints = 0.00;
                dataLoadedFromCloud = false;
            }

            currentUserUid = user.uid; 
            window.currentUserEmail = user.email || "Registered User"; 
            loginView.style.display = 'none';
            
            myDeviceId = 'app_' + user.uid.substring(0, 8) + '_' + Math.random().toString(36).substr(2, 5);
            localStorage.setItem('ay_device_id', myDeviceId);

            loadCategoryView('home');
            fetchUserData().then(() => { renderPersonalizedRows(); });
        } else {
            currentUserUid = null; 
            window.currentUserEmail = null; 
            continueWatching = []; 
            alreadyWatched = []; 
            myList = []; 
            progressMap = {};
            dataLoadedFromCloud = false;
            
            localStorage.removeItem('ay_device_id');
            
            loginView.style.display = 'flex'; 
            if (rotationIntervalId) clearInterval(rotationIntervalId);
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault(); authErrorMsg.style.color = "white"; authErrorMsg.innerText = "Checking credentials...";
        try { await signInWithEmailAndPassword(auth, authEmailInput.value, authPasswordInput.value); authErrorMsg.innerText = ""; } 
        catch (error) { authErrorMsg.style.color = "#E50914"; authErrorMsg.innerText = "Incorrect email or password."; }
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

    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!currentUserUid || !currentModalData) return;
            const emojiType = btn.getAttribute('data-emoji');
            const movieId = currentModalData.id.toString();
            
            if (!progressMap[movieId] || typeof progressMap[movieId] !== 'object') progressMap[movieId] = {};
            
            const previousEmoji = progressMap[movieId].userEmoji;
            if (previousEmoji === emojiType) return; 

            if (!globalReactionsMap[movieId]) globalReactionsMap[movieId] = { "🔥": 0, "🤯": 0, "😂": 0, "😴": 0 };
            
            if (previousEmoji && globalReactionsMap[movieId][previousEmoji] > 0) {
                globalReactionsMap[movieId][previousEmoji]--;
            }

            globalReactionsMap[movieId][emojiType] = (globalReactionsMap[movieId][emojiType] || 0) + 1;
            progressMap[movieId].userEmoji = emojiType;
            saveUserData();
            
            updateEmojiUI(movieId);

            document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('user-reacted'));
            btn.classList.add('user-reacted');

            try {
                fetch(GOOGLE_SHEET_URL, {
                    method: "POST", mode: "cors", redirect: "follow",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action: "react", movieId: movieId, emoji: emojiType, oldEmoji: previousEmoji })
                });
            } catch (err) { }
        });
    });

    function updateEmojiUI(movieId) {
        const counts = globalReactionsMap[movieId] || { "🔥": 0, "🤯": 0, "😂": 0, "😴": 0 };
        const elFire = document.getElementById('count-fire'); const elMindblown = document.getElementById('count-mindblown');
        const elFunny = document.getElementById('count-funny'); const elBoring = document.getElementById('count-boring');
        if (elFire) elFire.innerText = counts["🔥"] || 0; if (elMindblown) elMindblown.innerText = counts["🤯"] || 0;
        if (elFunny) elFunny.innerText = counts["😂"] || 0; if (elBoring) elBoring.innerText = counts["😴"] || 0;
    }

    function renderSkeletons(container, count = 10, isTop10 = false) {
        if (!container) return; container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const div = document.createElement('div');
            div.className = isTop10 ? 'skeleton-top10' : 'skeleton-card';
            container.appendChild(div);
        }
    }

    async function loadCategoryView(viewType) {
        renderPersonalizedRows();
        const top10Container = document.getElementById('top-10-container'); const top10Row = document.getElementById('top-10-row');
        const row1 = document.getElementById('trending-row'); const row2 = document.getElementById('action-row');
        const row3 = document.getElementById('comedy-row'); const row4 = document.getElementById('series-row');
        const title1 = document.getElementById('row1-title'); const title2 = document.getElementById('row2-title');
        const title3 = document.getElementById('row3-title'); const title4 = document.getElementById('row4-title');
        renderSkeletons(row1); renderSkeletons(row2); renderSkeletons(row3); renderSkeletons(row4);
        try {
            if (viewType === 'home') {
                top10Container.style.display = 'block'; renderSkeletons(top10Row, 10, true);
                const tData = await (await fetch(`${BASE_URL}/trending/all/day?api_key=${API_KEY}`)).json();
                populateTop10Row(tData.results.slice(0, 10), top10Row); populateRow(tData.results, row1, false); setupHero(tData.results.slice(0, 5));
                const aData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=28`)).json(); populateRow(aData.results, row2, false);
                const cData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=35`)).json(); populateRow(cData.results, row3, false);
                const sData = await (await fetch(`${BASE_URL}/trending/tv/day?api_key=${API_KEY}`)).json(); populateRow(sData.results, row4, true);
            } else if (viewType === 'animations') {
                top10Container.style.display = 'none';
                if (title1) title1.innerText = currentLang === 'es' ? "🍿 Top Películas de Animación" : "🍿 Top Animated Movies";
                if (title2) title2.innerText = currentLang === 'es' ? "🎌 Anime y Series Animadas" : "🎌 Anime & Animated Series";
                if (title3) title3.innerText = currentLang === 'es' ? "🧸 Animación Familiar" : "🧸 Family Animation";
                if (title4) title4.innerText = currentLang === 'es' ? "🔥 Lanzamientos Animados" : "🔥 Trending Animated Releases";
                const animMovData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json();
                populateRow(animMovData.results, row1, false); setupHero(animMovData.results.slice(0, 5));
                const animTvData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc`)).json(); populateRow(animTvData.results, row2, true);
                const familyAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16,10751&sort_by=popularity.desc`)).json(); populateRow(familyAnimData.results, row3, false);
                const trendingAnimData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=vote_count.desc`)).json(); populateRow(trendingAnimData.results, row4, false);
            } else {
                top10Container.style.display = 'none';
                if (viewType === 'tv') {
                    if (title1) title1.innerText = currentLang === 'es' ? "📺 Top Series de TV" : "📺 Top TV Shows";
                    if (title2) title2.innerText = currentLang === 'es' ? "🦸‍♂️ TV de Acción" : "🦸‍♂️ Action TV";
                    if (title3) title3.innerText = currentLang === 'es' ? "😂 TV de Comedia" : "😂 Comedy TV";
                    if (title4) title4.innerText = currentLang === 'es' ? "🎭 TV de Drama" : "🎭 Drama TV";
                    const tData = await (await fetch(`${BASE_URL}/trending/tv/week?api_key=${API_KEY}`)).json(); populateRow(tData.results, row1, true); setupHero(tData.results.slice(0, 5), true);
                    const aData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=10759`)).json(); populateRow(aData.results, row2, true);
                    const cData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=35`)).json(); populateRow(cData.results, row3, true);
                    const dData = await (await fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=18`)).json(); populateRow(dData.results, row4, true);
                } else if (viewType === 'movies') {
                    if (title1) title1.innerText = currentLang === 'es' ? "🎬 Top Películas" : "🎬 Top Movies";
                    if (title2) title2.innerText = currentLang === 'es' ? "💥 Películas de Acción" : "💥 Action Movies";
                    if (title3) title3.innerText = currentLang === 'es' ? "😂 Películas de Comedia" : "😂 Comedy Movies";
                    if (title4) title4.innerText = currentLang === 'es' ? "👻 Películas de Terror" : "👻 Horror Movies";
                    const tData = await (await fetch(`${BASE_URL}/trending/movie/week?api_key=${API_KEY}`)).json(); populateRow(tData.results, row1, false); setupHero(tData.results.slice(0, 5));
                    const aData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=28`)).json(); populateRow(aData.results, row2, false);
                    const cData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=35`)).json(); populateRow(cData.results, row3, false);
                    const hData = await (await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=27`)).json(); populateRow(hData.results, row4, false);
                }
            }
        } catch (error) { }
        setAppLanguage(currentLang);
        syncLocalProgressBars();
    }

    function renderHeroDots() {
        heroDotsContainer.innerHTML = '';
        trendingMoviesList.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `hero-dot tv-focusable ${idx === currentHeroIndex ? 'active' : ''}`;
            dot.setAttribute('tabindex', '0');
            dot.onclick = () => {
                currentHeroIndex = idx; updateHeroBillboard(trendingMoviesList[currentHeroIndex]); startHeroRotationLoop();
            };
            heroDotsContainer.appendChild(dot);
        });
    }

    function setupHero(results, isTV = false) {
        if (results && results.length > 0) {
            trendingMoviesList = results.map(item => ({ ...item, isTV: isTV }));
            currentHeroIndex = 0; updateHeroBillboard(trendingMoviesList[0]); startHeroRotationLoop();
        }
    }

    async function renderPersonalizedRows() {
        const myListContainer = document.getElementById('my-list-container'); const myListRow = document.getElementById('my-list-row');
        const cwContainer = document.getElementById('continue-watching-container'); const cwRow = document.getElementById('continue-watching-row');
        const awContainer = document.getElementById('already-watched-container'); const awRow = document.getElementById('already-watched-row');
        const recContainer = document.getElementById('recommended-container'); const recRow = document.getElementById('recommended-row');
        const communityContainer = document.getElementById('community-container'); const communityRow = document.getElementById('community-row');

        if (myList.length > 0) { myListContainer.style.display = 'block'; populateRow(myList, myListRow, false); } else { myListContainer.style.display = 'none'; }
        if (alreadyWatched.length > 0) { awContainer.style.display = 'block'; populateRow(alreadyWatched, awRow, false); } else { awContainer.style.display = 'none'; }

        if (globalCommunityMovies.length > 0 && communityContainer && communityRow) {
            communityContainer.style.display = 'block'; communityRow.innerHTML = '';
            globalCommunityMovies.forEach(item => {
                const movieId = item.id || item.movieId || item[0];
                const movieTitle = item.title || item.movieTitle || item.name || item[1];
                const moviePoster = item.poster_path || item.posterPath || item[2];
                const addedByUser = item.addedBy || item.uid || item[3];
                if (!movieId || !moviePoster) return;

                const card = document.createElement('div');
                card.className = 'movie-card tv-focusable'; card.setAttribute('data-id', movieId.toString());
                card.setAttribute('tabindex', '0'); card.setAttribute('data-community-item', 'true');
                card.setAttribute('data-added-by-me', (addedByUser === currentUserUid).toString());
                card.innerHTML = `<img src="${IMAGE_BASE_URL}${moviePoster}" alt="${movieTitle}"><div class="card-info"><div class="card-title">${movieTitle}</div><div class="card-meta"><span style="color:#e50914; font-weight:bold;">👥 Shared Party</span></div></div>`;
                card.addEventListener('click', () => openDetailsModal(movieId, false));
                communityRow.appendChild(card);
            });
        } else if (communityContainer) { communityContainer.style.display = 'none'; }

        if (continueWatching.length > 0) {
            cwContainer.style.display = 'block'; populateRow(continueWatching, cwRow, false);
            const lastWatched = continueWatching[0];
            fetch(`${BASE_URL}/${lastWatched.media_type}/${lastWatched.id}/similar?api_key=${API_KEY}`)
                .then(res => res.json()).then(data => {
                    if (data.results && data.results.length > 0) {
                        recContainer.style.display = 'block'; const formattedRecs = data.results.map(item => ({ ...item, media_type: lastWatched.media_type }));
                        populateRow(formattedRecs, recRow, lastWatched.media_type === 'tv'); syncLocalProgressBars();
                    } else { recContainer.style.display = 'none'; }
                }).catch(e => { recContainer.style.display = 'none'; });
        } else { cwContainer.style.display = 'none'; recContainer.style.display = 'none'; }

        syncLocalProgressBars();
    }

    function toggleMyList(data) {
        if (!data || !currentUserUid) return;
        const index = myList.findIndex(item => item.id === data.id);
        if (index > -1) { myList.splice(index, 1); }
        else { myList.unshift({ id: data.id, title: data.title || data.name, poster_path: data.poster_path, media_type: data.media_type, release_date: data.release_date || data.first_air_date, vote_average: data.vote_average }); }
        saveUserData(); renderPersonalizedRows();
    }

    function addToContinueWatching(data) {
        if (!data || !currentUserUid) return;
        continueWatching = continueWatching.filter(item => item.id !== data.id);
        continueWatching.unshift({ id: data.id, title: data.title || data.name, poster_path: data.poster_path, media_type: data.media_type, release_date: data.release_date || data.first_air_date, vote_average: data.vote_average });
        if (continueWatching.length > 10) continueWatching.pop();
        alreadyWatched = alreadyWatched.filter(item => item.id !== data.id);
        saveUserData(); renderPersonalizedRows();
    }

    async function openActorModal(personId) {
        try {
            const res = await fetch(`${BASE_URL}/person/${personId}?api_key=${API_KEY}&append_to_response=combined_credits`);
            const data = await res.json();
            actorNameEl.innerText = data.name; actorBioEl.innerText = data.biography || "No biography available.";
            actorPhotoEl.src = data.profile_path ? `${IMAGE_BASE_URL}${data.profile_path}` : 'https://via.placeholder.com/200x300?text=No+Image';
            const sortedMovies = data.combined_credits.cast.sort((a, b) => b.popularity - a.popularity);
            populateRow(sortedMovies, actorMoviesRow, false); actorModal.style.display = 'block';
        } catch (e) { }
    }

    async function openDetailsModal(id, isTV) {
        try {
            document.querySelector('.details-content').scrollTop = 0;
            clearTimeout(modalTrailerTimeout); modalTrailerFrame.src = ""; modalTrailerFrame.style.display = 'none';

            const type = isTV ? 'tv' : 'movie';
            const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&append_to_response=credits,similar`);
            const data = await res.json();

            data.media_type = type; currentModalData = data;
            document.getElementById('details-title').innerText = data.title || data.name;
            document.getElementById('details-desc').innerText = data.overview || "No description available.";
            document.getElementById('details-rating').innerText = `⭐ ${parseFloat(data.vote_average).toFixed(1)} Rating`;

            const releaseDate = data.release_date || data.first_air_date;
            document.getElementById('details-year').innerText = releaseDate ? releaseDate.substring(0, 4) : "N/A";
            document.getElementById('details-hero').style.backgroundImage = `url('${HERO_IMAGE_BASE_URL}${data.backdrop_path || data.poster_path}')`;

            const castContainer = document.getElementById('details-cast'); castContainer.innerHTML = '';
            if (data.credits && data.credits.cast && data.credits.cast.length > 0) {
                data.credits.cast.slice(0, 6).forEach((c, index) => {
                    const span = document.createElement('span'); span.innerText = c.name + (index < 5 ? ", " : "");
                    span.style.cssText = "cursor: pointer; color: #fff; text-decoration: underline; margin-right: 5px; transition: color 0.2s;";
                    span.className = 'tv-focusable'; span.setAttribute('tabindex', '0'); span.onclick = () => openActorModal(c.id);
                    castContainer.appendChild(span);
                });
            } else { castContainer.innerText = "Cast information unavailable."; }

            if (data.similar && data.similar.results && data.similar.results.length > 0) {
                const formattedSimilar = data.similar.results.map(item => ({ ...item, media_type: type }));
                populateRow(formattedSimilar, modalSimilarRow, isTV);
            } else { modalSimilarRow.innerHTML = "<p style='color: #aaa;'>No similar shows found.</p>"; }

            const dict = translations[currentLang] || translations.en;

            let isInList = myList.some(m => m.id === id);
            detailsMylistBtn.innerText = isInList ? dict.myListAdded : dict.myListAdd;
            detailsMylistBtn.style.backgroundColor = isInList ? "#46d369" : "rgba(109, 109, 110, 0.7)";
            detailsMylistBtn.onclick = () => {
                toggleMyList(currentModalData); isInList = !isInList;
                detailsMylistBtn.innerText = isInList ? dict.myListAdded : dict.myListAdd;
                detailsMylistBtn.style.backgroundColor = isInList ? "#46d369" : "rgba(109, 109, 110, 0.7)";
            };

            const detailsBtnGroup = document.getElementById('details-btn-group') || detailsPlayBtn.parentElement;
            const oldShareBtn = document.getElementById('details-community-btn');
            if (oldShareBtn) oldShareBtn.remove();
            const communityShareBtn = document.createElement('button');
            communityShareBtn.id = "details-community-btn"; communityShareBtn.className = "tv-focusable"; communityShareBtn.setAttribute('tabindex', '0');
            communityShareBtn.style.cssText = "padding: 12px 30px; font-size: 1.2rem; font-weight: bold; background: rgba(229, 9, 20, 0.2); color: #fff; border: 1px solid #E50914; border-radius: 5px; cursor: pointer; transition: 0.2s;";
            
            communityShareBtn.innerText = dict.shareCommunityBtn; 
            
            communityShareBtn.onmouseover = () => communityShareBtn.style.background = "#E50914";
            communityShareBtn.onmouseout = () => communityShareBtn.style.background = "rgba(229, 9, 20, 0.2)";
            communityShareBtn.onclick = () => { shareMovieToCommunity(currentModalData); };
            detailsBtnGroup.appendChild(communityShareBtn);

            modalTrailerTimeout = setTimeout(async () => {
                const trailerKey = await fetchMovieTrailer(id, isTV);
                if (trailerKey) { modalTrailerFrame.style.display = 'block'; modalTrailerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=0&controls=0&showinfo=0&rel=0`; }
            }, 500);

            detailsTrailerBtn.onclick = async () => {
                clearTimeout(modalTrailerTimeout);
                const trailerKey = await fetchMovieTrailer(id, isTV);
                if (trailerKey) { modalTrailerFrame.style.display = 'block'; modalTrailerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=1&showinfo=0&rel=0`; } 
                else { showCustomAlert("Trailer not available for this title."); }
            };

            if (isTV) {
                modalTvControls.style.display = 'flex'; modalSeasonSelect.innerHTML = '';
                const tvMemory = progressMap[id] && typeof progressMap[id] === 'object' ? progressMap[id] : null;
                const resumeSeason = tvMemory ? tvMemory.lastSeason : 1; const resumeEpisode = tvMemory ? tvMemory.lastEpisode : 1;

                const validSeasons = data.seasons ? data.seasons.filter(s => s.season_number > 0) : [];
                validSeasons.forEach(s => {
                    const option = document.createElement('option'); option.value = s.season_number; option.innerText = `Season ${s.season_number}`;
                    if (parseInt(s.season_number) === parseInt(resumeSeason)) option.selected = true;
                    modalSeasonSelect.appendChild(option);
                });

                if (validSeasons.length > 0) { await populateModalEpisodes(id, modalSeasonSelect.value); }
                if (modalEpisodeSelect.children.length >= resumeEpisode) { modalEpisodeSelect.value = resumeEpisode; }
                modalSeasonSelect.onchange = async (e) => { await populateModalEpisodes(id, e.target.value); };

                detailsPlayBtn.onclick = (e) => {
                    if (e) { e.preventDefault(); e.stopPropagation(); }
                    clearTimeout(modalTrailerTimeout); detailsModal.style.display = 'none'; modalTrailerFrame.src = "";
                    try { addToContinueWatching(currentModalData); } catch (err) { }
                    launchVideoStream(id, true, modalSeasonSelect.value, modalEpisodeSelect.value);
                };
            } else {
                modalTvControls.style.display = 'none';
                detailsPlayBtn.onclick = (e) => {
                    if (e) { e.preventDefault(); e.stopPropagation(); }
                    clearTimeout(modalTrailerTimeout); detailsModal.style.display = 'none'; modalTrailerFrame.src = "";
                    try { addToContinueWatching(currentModalData); } catch (err) { }
                    launchVideoStream(id, false);
                };
            }
            
            document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('user-reacted'));
            const userMemory = progressMap[id] && typeof progressMap[id] === 'object' ? progressMap[id] : null;
            if (userMemory && userMemory.userEmoji) {
                const activeBtn = document.querySelector(`.emoji-btn[data-emoji="${userMemory.userEmoji}"]`);
                if (activeBtn) activeBtn.classList.add('user-reacted');
            }

            detailsModal.style.display = 'block'; updateEmojiUI(id.toString());

        } catch (error) { console.error("Failed to load details modal:", error); }
    }

    async function populateModalEpisodes(tvId, seasonNumber) {
        modalEpisodeSelect.innerHTML = '<option>Loading...</option>';
        try {
            const res = await fetch(`${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}`);
            const data = await res.json();
            modalEpisodeSelect.innerHTML = '';
            data.episodes.forEach(e => {
                const option = document.createElement('option'); option.value = e.episode_number; option.innerText = `Ep ${e.episode_number}: ${e.name}`;
                modalEpisodeSelect.appendChild(option);
            });
        } catch (e) { }
    }

    closeDetailsBtn.addEventListener('click', () => {
        clearTimeout(modalTrailerTimeout); detailsModal.style.display = 'none'; modalTrailerFrame.src = "";
    });

    function attemptStreamLoad(rawStreamUrl, nativePlayer, streamData, currentLang) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Stream attempt timed out"));
            }, 12000);

            if (rawStreamUrl.includes('m3u8') && window.Hls && Hls.isSupported()) {
                if (window.activeHlsInstance) {
                    window.activeHlsInstance.destroy();
                }
                const hls = new Hls({
                    defaultAudioCodec: 'mp4a.40.2',
                    renderTextTracksNatively: true
                });
                window.activeHlsInstance = hls;

                hls.loadSource(rawStreamUrl);
                hls.attachMedia(nativePlayer);

                hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                    clearTimeout(timeout);
                    
                    const qualitySelect = document.getElementById('quality-select');
                    if (qualitySelect && data.levels && data.levels.length > 1) {
                        qualitySelect.innerHTML = '<option value="-1">⚙️ Auto Quality</option>';
                        data.levels.forEach((level, index) => {
                            const resHeight = level.height ? `${level.height}p` : `Bitrate ${Math.round(level.bitrate / 1000)}k`;
                            const option = document.createElement('option');
                            option.value = index;
                            option.innerText = resHeight;
                            qualitySelect.appendChild(option);
                        });
                        qualitySelect.style.display = 'inline-block';

                        qualitySelect.onchange = (e) => {
                            const levelIndex = parseInt(e.target.value, 10);
                            hls.currentLevel = levelIndex;
                            if (levelIndex === -1) {
                                showRewardToast("📶 Auto Quality", "Adaptive Bitrate Enabled");
                            } else {
                                const selectedLabel = e.target.options[e.target.selectedIndex].text;
                                showRewardToast("⚙️ Quality Locked", `Stream locked to ${selectedLabel}`);
                            }
                        };
                    } else if (qualitySelect) {
                        qualitySelect.style.display = 'none';
                    }

                    const audioTracks = hls.audioTracks;
                    if (audioTracks && audioTracks.length > 0) {
                        const englishTrackIndex = audioTracks.findIndex(track => {
                            const lang = (track.lang || track.name || '').toLowerCase();
                            return lang.includes('en') || lang.includes('eng') || lang.includes('english');
                        });
                        if (englishTrackIndex !== -1) hls.audioTrack = englishTrackIndex;
                    }
                    nativePlayer.play().then(resolve).catch(reject);
                });

                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(event, data) {
                    if (data.audioTracks && data.audioTracks.length > 0) {
                        const englishTrackIndex = data.audioTracks.findIndex(track => {
                            const lang = (track.lang || track.name || '').toLowerCase();
                            return lang.includes('en') || lang.includes('eng') || lang.includes('english');
                        });
                        if (englishTrackIndex !== -1) hls.audioTrack = englishTrackIndex;
                    }
                });

                hls.on(Hls.Events.ERROR, function(event, data) {
                    if (data.fatal) {
                        clearTimeout(timeout);
                        reject(new Error("HLS Fatal Error: " + data.type));
                    }
                });

            } else {
                if (window.activeHlsInstance) {
                    window.activeHlsInstance.destroy();
                    window.activeHlsInstance = null;
                }
                const qualitySelect = document.getElementById('quality-select');
                if (qualitySelect) qualitySelect.style.display = 'none';

                nativePlayer.src = rawStreamUrl;
                nativePlayer.play().then(() => {
                    clearTimeout(timeout);
                    resolve();
                }).catch((err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }
        });
    }

    async function launchVideoStream(id, isTV = false, season = 1, episode = 1) {
        try {
            currentTvState = { id, isTV, season: parseInt(season), episode: parseInt(episode) };
            window.activeVideoStartTime = Date.now();
            window.rewardClaimedForSession = false;

            if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);
            if (localProgressTrackerInterval) clearInterval(localProgressTrackerInterval); 
            if (loadingBannerTimer) clearInterval(loadingBannerTimer);

            if (isTV) {
                if (!progressMap[id] || typeof progressMap[id] !== 'object') progressMap[id] = {};
                progressMap[id].lastSeason = parseInt(season);
                progressMap[id].lastEpisode = parseInt(episode);
                saveUserData();
            }

            requestWakeLock();
            try { heroPlayerFrame.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*'); } catch (e) { }

            const dict = translations[currentLang] || translations.en;
            episodeIndicatorText.innerText = isTV ? `${dict.playingLabel} ${season}, ${dict.episodeLabel} ${episode}` : "";

            if (serverSelect) serverSelect.style.display = 'none';

            videoModal.style.display = 'block';
            
            let loadingBanner = document.getElementById('loading-earn-banner');
            if (!loadingBanner) {
                loadingBanner = document.createElement('div');
                loadingBanner.id = 'loading-earn-banner';
                loadingBanner.style.cssText = 'position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); background: rgba(15, 15, 15, 0.96); color: #ffd700; padding: 25px 40px; font-size: 1.6rem; font-weight: bold; border-radius: 12px; border: 2px solid #E50914; z-index: 99999; text-align: center; transition: opacity 0.5s ease; pointer-events: none; box-shadow: 0 0 35px rgba(229, 9, 20, 0.7); font-family: Arial, sans-serif;';
                videoModal.appendChild(loadingBanner);
            }

            let elapsedSeconds = 0;
            const updateBannerContent = () => {
                const formattedSecs = String(elapsedSeconds).padStart(2, '0');
                loadingBanner.innerHTML = `
                    <div style="font-size: 2.2rem; margin-bottom: 8px;">🎬 🍿 🎥</div>
                    <div style="color: #ffd700; font-size: 1.5rem;">${dict.loadingStream} <span style="font-size: 1.2rem; color: #e50914;">(${formattedSecs}s)</span></div>
                    <div style="font-size: 1.2rem; font-weight: normal; color: #fff; margin-top: 8px;">${dict.watchEarn}</div>
                    <div style="font-size: 1.0rem; font-weight: bold; color: #46d369; margin-top: 10px; border-top: 1px solid #333; padding-top: 8px;">${dict.movieStartSoon}</div>
                `;
            };

            updateBannerContent();
            loadingBanner.style.opacity = '1';
            loadingBanner.style.display = 'block';

            loadingBannerTimer = setInterval(() => {
                elapsedSeconds++;
                updateBannerContent();
            }, 1000);

            const nativePlayer = document.getElementById('native-video-player');
            const iframe = document.getElementById('video-player-frame');

            if (iframe) iframe.style.display = 'none';
            if (nativePlayer) {
                nativePlayer.style.display = 'block';
                nativePlayer.style.opacity = '0.3';
                nativePlayer.pause();
            }

            try {
                let imdbId = null;
                try {
                    const tmdbType = isTV ? 'tv' : 'movie';
                    const idRes = await fetch(`${BASE_URL}/${tmdbType}/${id}/external_ids?api_key=${API_KEY}`);
                    const idData = await idRes.json();
                    imdbId = idData.imdb_id || null;
                } catch (e) { }

                const myScraperApiUrl = "https://twilight-mud-4868.yalex6677.workers.dev";
                const streamType = isTV ? 'series' : 'movie';
                let endpoint = `${myScraperApiUrl}/api/streams/${streamType}/${id}`;

                if (isTV) endpoint += `?season=${season}&episode=${episode}`;

                const streamRes = await fetch(endpoint);
                const streamData = await streamRes.json();

                if (!streamData || !streamData.streams || streamData.streams.length === 0) {
                    throw new Error("0 streams found.");
                }

                const playableStreams = streamData.streams.filter(s => {
                    const link = (s.url || s.playlist || s.link || '').toLowerCase();
                    const title = (s.title || s.name || '').toLowerCase();
                    const isSpanish = title.includes('latino') || title.includes('spanish') || title.includes('esp') || title.includes('dubbed');
                    const isPlayable = link.includes('m3u8') || link.includes('.mp4');
                    return isPlayable && !isSpanish;
                });

                const streamCandidates = playableStreams.length > 0 ? playableStreams : streamData.streams;

                if (nativePlayer) {
                    while (nativePlayer.firstChild) {
                        nativePlayer.removeChild(nativePlayer.firstChild);
                    }

                    let subtitlesArray = streamData.subtitles || streamData.captions || [];
                    if (subtitlesArray && subtitlesArray.length > 0) {
                        subtitlesArray.forEach(sub => {
                            const track = document.createElement('track');
                            track.kind = 'subtitles';
                            const langName = sub.lang || sub.language || 'Unknown';
                            track.label = langName;
                            track.srclang = langName.substring(0, 2).toLowerCase();
                            track.src = sub.url || sub.file;
                            
                            if (currentLang === 'es' && (track.srclang === 'es' || langName.toLowerCase().includes('spa'))) {
                                track.default = true;
                            } else if (currentLang === 'en' && (track.srclang === 'en' || langName.toLowerCase().includes('eng'))) {
                                track.default = true;
                            }
                            
                            nativePlayer.appendChild(track);
                        });
                    }
                    
                    const trackingId = isTV ? `${id}-S${season}E${episode}` : id.toString();

                    nativePlayer.addEventListener('loadedmetadata', async function resumeHandler() {
                        nativePlayer.removeEventListener('loadedmetadata', resumeHandler);
                        await checkAndResumeLocalVideo(nativePlayer, trackingId);
                    });
                    startLocalProgressTracker(nativePlayer, trackingId);

                    const hideBanner = () => {
                        if (loadingBannerTimer) clearInterval(loadingBannerTimer);
                        const banner = document.getElementById('loading-earn-banner');
                        if (banner) {
                            banner.style.opacity = '0';
                            setTimeout(() => { if (banner) banner.style.display = 'none'; }, 500);
                        }
                        nativePlayer.removeEventListener('playing', hideBanner);
                    };
                    nativePlayer.addEventListener('playing', hideBanner);

                    nativePlayer.addEventListener('ended', () => {
                        if (currentTvState.isTV) {
                            let nextSeason = currentTvState.season;
                            let nextEpisode = currentTvState.episode + 1;
                            let hasNext = true;

                            if (currentModalData && currentModalData.seasons) {
                                const currentSeasonData = currentModalData.seasons.find(s => s.season_number === nextSeason);
                                
                                if (currentSeasonData && nextEpisode > currentSeasonData.episode_count) {
                                    nextSeason += 1;
                                    nextEpisode = 1;
                                }
                                
                                const nextSeasonData = currentModalData.seasons.find(s => s.season_number === nextSeason);
                                if (!nextSeasonData) {
                                    hasNext = false; 
                                }
                            }

                            if (hasNext) {
                                showRewardToast("🍿 Up Next...", `Loading Season ${nextSeason}, Episode ${nextEpisode}`);
                                
                                setTimeout(() => {
                                    launchVideoStream(currentTvState.id, true, nextSeason, nextEpisode);
                                }, 3000);
                            } else {
                                moveToWatchItAgain();
                            }
                        } else {
                            moveToWatchItAgain();
                        }

                        function moveToWatchItAgain() {
                            if (currentModalData) {
                                continueWatching = continueWatching.filter(item => item.id !== currentModalData.id);
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
                                saveUserData();
                                renderPersonalizedRows();
                            }
                        }
                    });

                    let streamLoaded = false;
                    for (let i = 0; i < streamCandidates.length; i++) {
                        const candidate = streamCandidates[i];
                        const rawStreamUrl = candidate.url || candidate.playlist || candidate.link;
                        if (!rawStreamUrl) continue;

                        try {
                            console.log(`[Failover Engine] Attempting stream source #${i + 1}...`);
                            await attemptStreamLoad(rawStreamUrl, nativePlayer, streamData, currentLang);
                            console.log(`[Failover Engine] Successfully connected to source #${i + 1}!`);
                            streamLoaded = true;
                            break; 
                        } catch (attemptError) {
                            console.warn(`[Failover Engine] Source #${i + 1} failed:`, attemptError.message);
                        }
                    }

                    if (!streamLoaded) {
                        throw new Error("All backup stream sources failed to load.");
                    }

                    nativePlayer.style.opacity = '1';
                }

            } catch (error) {
                console.warn("Stream extraction failed:", error);
                episodeIndicatorText.innerHTML = "⚠️ <span style='color:red;'>Stream loading failed.</span>";
                if (nativePlayer) nativePlayer.style.opacity = '1';
                
                if (loadingBannerTimer) clearInterval(loadingBannerTimer);
                const banner = document.getElementById('loading-earn-banner');
                if (banner) {
                    banner.style.opacity = '0';
                    setTimeout(() => { if (banner) banner.style.display = 'none'; }, 500);
                }
            }

            window.watchTimerInterval = setInterval(() => {
                if (!currentUserUid || window.rewardClaimedForSession) return;
                const elapsedMinutes = (Date.now() - window.activeVideoStartTime) / 60000;

                if (!currentTvState.isTV) {
                    if (elapsedMinutes >= 60) {
                        window.rewardClaimedForSession = true;
                        window.userTotalPoints = parseFloat((window.userTotalPoints + 0.25).toFixed(2));
                        progressMap['_points_'] = window.userTotalPoints;
                        updatePointsUI(); saveUserData();
                        showRewardToast("🍿 Reward Earned!", "You earned $0.25 BZD for watching 1 hour!");
                    }
                } else {
                    if (elapsedMinutes >= 40) {
                        window.rewardClaimedForSession = true;
                        if (!progressMap[currentTvState.id] || typeof progressMap[currentTvState.id] !== 'object') progressMap[currentTvState.id] = {};
                        if (!Array.isArray(progressMap[currentTvState.id].completedEpisodes)) progressMap[currentTvState.id].completedEpisodes = [];

                        const currentEpKey = `S${currentTvState.season}E${currentTvState.episode}`;
                        if (!progressMap[currentTvState.id].completedEpisodes.includes(currentEpKey)) {
                            progressMap[currentTvState.id].completedEpisodes.push(currentEpKey);
                        }

                        let isSeriesFinale = false;
                        let totalShowEpisodes = 0; let maxSeason = 1; let maxEpisode = 1;

                        if (currentModalData && currentModalData.seasons) {
                            const validSeasons = currentModalData.seasons.filter(s => s.season_number > 0);
                            maxSeason = Math.max(...validSeasons.map(s => s.season_number));
                            validSeasons.forEach(s => { totalShowEpisodes += (s.episode_count || 0); });
                            const targetSeasonObj = validSeasons.find(s => s.season_number === maxSeason);
                            maxEpisode = targetSeasonObj ? targetSeasonObj.episode_count : 1;
                            if (currentTvState.season === maxSeason && currentTvState.episode === maxEpisode) isSeriesFinale = true;
                        }

                        const watchedCount = progressMap[currentTvState.id].completedEpisodes.length;
                        const requiredEpisodes = Math.max(1, Math.floor(totalShowEpisodes * 0.8));

                        if (isSeriesFinale && watchedCount >= requiredEpisodes) {
                            window.userTotalPoints = parseFloat((window.userTotalPoints + 0.50).toFixed(2));
                            progressMap['_points_'] = window.userTotalPoints;
                            updatePointsUI();
                            showRewardToast("🎉 Series Complete!", "You earned $0.50 BZD!");
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

    closeModalBtn.addEventListener('click', () => {
        if (window.watchTimerInterval) clearInterval(window.watchTimerInterval);
        if (localProgressTrackerInterval) clearInterval(localProgressTrackerInterval); 
        if (loadingBannerTimer) clearInterval(loadingBannerTimer);

        const banner = document.getElementById('loading-earn-banner');
        if (banner) banner.style.display = 'none';

        videoModal.style.display = 'none';
        
        const qualitySelect = document.getElementById('quality-select');
        if (qualitySelect) qualitySelect.style.display = 'none';

        const nativePlayer = document.getElementById('native-video-player');
        if (nativePlayer) {
            nativePlayer.pause();
            nativePlayer.removeAttribute('src');
            nativePlayer.load();
            nativePlayer.style.opacity = '1';
        }

        if (window.activeHlsInstance) {
            window.activeHlsInstance.destroy();
            window.activeHlsInstance = null;
        }

        releaseWakeLock(); 
        renderPersonalizedRows();
        
        try { 
            heroPlayerFrame.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*'); 
        } catch (e) { }
    });

    heroMuteBtn.addEventListener('click', () => {
        isHeroMuted = !isHeroMuted; heroMuteBtn.innerText = isHeroMuted ? "..." : "...";
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
        renderHeroDots(); const type = featuredMovie.isTV ? 'tv' : 'movie';
        try {
            const imgRes = await fetch(`${BASE_URL}/${type}/${featuredMovie.id}/images?api_key=${API_KEY}`);
            const imgData = await imgRes.json();
            const enLogo = imgData.logos ? imgData.logos.find(l => l.iso_639_1 === 'en') : null;
            const logoToUse = enLogo || (imgData.logos && imgData.logos.length > 0 ? imgData.logos[0] : null);

            if (logoToUse) {
                heroDisplayTitle.style.display = 'none'; heroDisplayLogo.style.display = 'block';
                heroDisplayLogo.src = `https://image.tmdb.org/t/p/w500${logoToUse.file_path}`;
            } else {
                heroDisplayLogo.style.display = 'none'; heroDisplayTitle.style.display = 'block';
                heroDisplayTitle.innerText = (featuredMovie.title || featuredMovie.name).toUpperCase();
            }
        } catch (e) {
            heroDisplayLogo.style.display = 'none'; heroDisplayTitle.style.display = 'block';
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
            heroPlayerFrame.style.display = 'block'; heroMuteBtn.style.display = 'flex';
            heroPlayerFrame.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerKey}&showinfo=0&rel=0&modestbranding=1&enablejsapi=1`;
            isHeroMuted = true; heroMuteBtn.innerText = "🔇";
        } else {
            heroPlayerFrame.src = ""; heroPlayerFrame.style.display = 'none'; heroMuteBtn.style.display = 'none';
        }
    }

    function populateTop10Row(movies, container) {
        if (!container) return; container.innerHTML = '';
        movies.forEach((item, index) => {
            if (!item.poster_path) return;
            const isTV = item.media_type === 'tv';
            const card = document.createElement('div');
            card.className = 'top-10-wrapper tv-focusable'; card.setAttribute('data-id', item.id); card.setAttribute('tabindex', '0');
            card.innerHTML = `<span class="top-10-number">${index + 1}</span><img src="${IMAGE_BASE_URL}${item.poster_path}" alt="${item.title || item.name}" class="top-10-poster">`;
            card.addEventListener('click', () => openDetailsModal(item.id, isTV));
            container.appendChild(card);
        });
        syncLocalProgressBars();
    }

    function populateRow(movies, container, isTV = false) {
        if (!container) return; container.innerHTML = '';
        movies.forEach(item => {
            if (!item.poster_path) return;
            const isTvItem = item.media_type === 'tv' || isTV;
            const card = createMovieCard(item, isTvItem);
            container.appendChild(card);
        });
        syncLocalProgressBars();
    }

    async function fetchLiveSearch(query) {
        const trimmed = query.trim();
        if (trimmed.length < 2) { searchDropdown.style.display = 'none'; return; }
        try {
            const lowerQuery = trimmed.toLowerCase();
            let endpoint = `${BASE_URL}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(trimmed)}`;

            if (lowerQuery === 'kdrama' || lowerQuery === 'k-drama' || lowerQuery === 'k drama' || lowerQuery === 'korean drama') {
                endpoint = `${BASE_URL}/discover/tv?api_key=${API_KEY}&with_original_language=ko&sort_by=popularity.desc`;
            }

            const response = await fetch(endpoint);
            const data = await response.json();
            searchDropdown.innerHTML = '';
            
            const validResults = data.results.map(item => ({
                ...item,
                media_type: item.media_type || 'tv' 
            })).filter(i => i.poster_path);

            if (validResults.length === 0) {
                searchDropdown.innerHTML = '<div style="padding: 12px; color: #aaa; text-align: center;">No results found</div>';
            } else {
                const resultsContainer = document.createElement('div');
                resultsContainer.style.cssText = "max-height: 320px; overflow-y: auto;";

                validResults.slice(0, 6).forEach(item => {
                    const isTV = (item.media_type === 'tv'); 
                    const div = document.createElement('div');
                    div.className = 'search-item tv-focusable'; 
                    div.setAttribute('tabindex', '0');
                    const year = (item.release_date || item.first_air_date || "N/A").substring(0, 4);
                    div.innerHTML = `<img src="${IMAGE_BASE_URL}${item.poster_path}" alt=""><div class="search-item-info"><span class="search-item-title">${item.title || item.name}</span><span class="search-item-meta">${isTV ? 'TV Series' : 'Movie'} • ${year}</span></div>`;
                    div.onclick = () => { searchDropdown.style.display = 'none'; searchInput.value = ''; openDetailsModal(item.id, isTV); };
                    resultsContainer.appendChild(div);
                });

                searchDropdown.appendChild(resultsContainer);

                const seeAllBtn = document.createElement('div');
                seeAllBtn.className = 'search-item tv-focusable';
                seeAllBtn.setAttribute('tabindex', '0');
                seeAllBtn.style.cssText = "position: sticky; bottom: 0; background: #E50914; color: #ffffff; font-weight: bold; text-align: center; justify-content: center; padding: 12px; z-index: 10; border-top: 1px solid #ff4d4d; box-shadow: 0 -4px 10px rgba(0,0,0,0.5); cursor: pointer; margin-bottom: -1px;";
                seeAllBtn.innerHTML = `🔍 See all ${validResults.length} results for "${trimmed}"`;
                seeAllBtn.onclick = () => {
                    searchDropdown.style.display = 'none';
                    renderAllSearchResultsRow(trimmed, validResults);
                };
                searchDropdown.appendChild(seeAllBtn);
            }
            searchDropdown.style.display = 'block';
        } catch (error) { }
    }

    function renderAllSearchResultsRow(query, results) {
        let searchContainer = document.getElementById('search-results-container');
        let searchRow = document.getElementById('search-results-row');
        const homeView = document.getElementById('home-view');

        if (!searchContainer) {
            searchContainer = document.createElement('div');
            searchContainer.id = 'search-results-container';
            searchContainer.className = 'row-container';
            searchContainer.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding-right: 40px;">
                    <h2 class="row-title" id="search-results-title">🔍 Search Results</h2>
                    <button id="close-search-results" class="tv-focusable" style="background: transparent; border: none; color: #E50914; font-weight: bold; font-size: 1rem; cursor: pointer;">&times; Clear Search</button>
                </div>
                <div class="row-wrapper">
                    <button class="row-arrow left-arrow tv-focusable" tabindex="0" onclick="scrollRow('search-results-row', 'left')">❮</button>
                    <div id="search-results-row" class="movie-row"></div>
                    <button class="row-arrow right-arrow tv-focusable" tabindex="0" onclick="scrollRow('search-results-row', 'right')">❯</button>
                </div>
            `;
            const heroSection = document.getElementById('hero-poster-bg');
            if (heroSection && heroSection.nextSibling) {
                homeView.insertBefore(searchContainer, heroSection.nextSibling);
            } else {
                homeView.prepend(searchContainer);
            }

            document.getElementById('close-search-results').onclick = () => {
                searchContainer.style.display = 'none';
                searchInput.value = '';
            };
        }

        document.getElementById('search-results-title').innerText = `🔍 Search Results for "${query}" (${results.length})`;
        searchRow = document.getElementById('search-results-row');
        populateRow(results, searchRow, false);
        searchContainer.style.display = 'block';

        searchContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { fetchLiveSearch(e.target.value); }, 400);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== searchInput && e.target !== searchDropdown) { searchDropdown.style.display = 'none'; }
    });

    function createMovieCard(item, isTV = false) {
        const card = document.createElement('div');
        card.className = 'movie-card tv-focusable'; card.setAttribute('data-id', item.id); card.setAttribute('tabindex', '0');
        const year = (item.release_date || item.first_air_date || "N/A").substring(0, 4);
        const rating = parseFloat(item.vote_average || 0).toFixed(1);
        card.innerHTML = `<img src="${IMAGE_BASE_URL}${item.poster_path}" alt="${item.title || item.name}"><div class="card-info"><div class="card-title">${item.title || item.name}</div><div class="card-meta"><span>${year}</span> <span>⭐ ${rating}</span></div></div>`;
        card.addEventListener('click', () => { openDetailsModal(item.id, isTV); });
        return card;
    }

    document.querySelectorAll('.brand-logo, #btn-home').forEach(btn => {
        btn.addEventListener('click', () => {
            searchInput.value = ''; loadCategoryView('home');
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.querySelector('[data-view="home"]').classList.add('active');
            const searchContainer = document.getElementById('search-results-container');
            if (searchContainer) searchContainer.style.display = 'none';
        });
    });

    async function checkSessionLock() {
        if (!currentUserUid || !dataLoadedFromCloud || window.isKickedOut || window.takeoverImmunity) return;
        try {
            const response = await fetch(GOOGLE_SHEET_URL, {
                method: "POST", mode: "cors", redirect: "follow",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "fetch", uid: currentUserUid, cacheBust: Date.now() })
            });
            const result = await response.json();
            if (result.exists) {
                const currentCloudDevice = (result.data.progress || {})['_active_device_'];
                if (currentCloudDevice && currentCloudDevice !== myDeviceId) {
                    window.isKickedOut = true;
                    document.body.innerHTML = `<div style="background:#000; color:#fff; position:fixed; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:999999; text-align:center; padding:20px; font-family:sans-serif;"><h1 style="color:#e50914; margin-bottom: 15px;">🚫 SESSION TERMINATED</h1><p style="font-size: 1.1rem; line-height: 1.5;">The account owner just logged in on another device.<br>You have been kicked out.</p></div>`;
                    setTimeout(() => { signOut(auth).then(() => { window.location.reload(); }).catch(() => { window.location.reload(); }); }, 4000);
                }
            }
        } catch (e) { }
    }

    setInterval(checkSessionLock, 10000);
    window.addEventListener('focus', checkSessionLock);
    window.addEventListener('click', () => {
        if (!window.lockCheckThrottled) {
            window.lockCheckThrottled = true; checkSessionLock(); setTimeout(() => { window.lockCheckThrottled = false; }, 10000);
        }
    });

    const btnForgotPassword = document.getElementById('btn-forgot-password');
    const resetPasswordModal = document.getElementById('reset-password-modal');
    const resetEmailInput = document.getElementById('reset-email-input');
    const resetCancelBtn = document.getElementById('reset-cancel-btn');
    const resetSubmitBtn = document.getElementById('reset-submit-btn');
    const resetStatusMsg = document.getElementById('reset-status-msg');

    if (btnForgotPassword) {
        btnForgotPassword.addEventListener('click', () => {
            resetEmailInput.value = authEmailInput.value || ''; resetStatusMsg.innerText = ''; resetPasswordModal.style.display = 'flex';
        });
    }
    if (resetCancelBtn) resetCancelBtn.addEventListener('click', () => { resetPasswordModal.style.display = 'none'; });
    
    if (resetSubmitBtn) {
        resetSubmitBtn.addEventListener('click', async () => {
            const email = resetEmailInput.value.trim();
            if (!email) { resetStatusMsg.style.color = '#E50914'; resetStatusMsg.innerText = 'Please enter a valid email.'; return; }
            try {
                resetStatusMsg.style.color = '#aaa'; resetStatusMsg.innerText = 'Sending link...';
                await sendPasswordResetEmail(auth, email);
                resetStatusMsg.style.color = '#46d369'; resetStatusMsg.innerText = '✅ Reset link sent to your email!';
                setTimeout(() => { resetPasswordModal.style.display = 'none'; }, 3000);
            } catch (error) { resetStatusMsg.style.color = '#E50914'; resetStatusMsg.innerText = '❌ Failed to send link. Try again.'; }
        });
    }

    const btnDeleteAccountMobile = document.getElementById('btn-delete-account-mobile');
    const deleteAccountModal = document.getElementById('delete-account-modal');
    const deleteCancelBtn = document.getElementById('delete-cancel-btn');
    const deleteConfirmBtn = document.getElementById('delete-confirm-btn');

    if (btnDeleteAccountMobile) {
        btnDeleteAccountMobile.addEventListener('click', () => { mobileMenu.style.right = '-100%'; deleteAccountModal.style.display = 'flex'; });
    }
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => { deleteAccountModal.style.display = 'none'; });
    
    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (user) {
                try {
                    deleteConfirmBtn.innerText = "Deleting...";
                    await fetch(GOOGLE_SHEET_URL, {
                        method: "POST", mode: "cors", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({ action: "deleteAccount", uid: user.uid })
                    });
                    await deleteUser(user); deleteAccountModal.style.display = 'none'; window.location.reload(); 
                } catch (error) {
                    alert("For security reasons, please Log Out and log back in before deleting your account.");
                    deleteAccountModal.style.display = 'none'; deleteConfirmBtn.innerText = "Yes, Delete";
                }
            }
        });
    }

    const btnSendReferral = document.getElementById('btn-send-referral');
    const referralFriendEmailInput = document.getElementById('referral-friend-email');
    const referralFriendPhoneInput = document.getElementById('referral-friend-phone');

    if (btnSendReferral) {
        btnSendReferral.addEventListener('click', () => {
            const friendEmail = referralFriendEmailInput ? referralFriendEmailInput.value.trim() : '';
            const friendPhone = referralFriendPhoneInput ? referralFriendPhoneInput.value.trim() : '';
            let hasError = false;

            if (!friendEmail) { if (referralFriendEmailInput) referralFriendEmailInput.style.borderColor = '#E50914'; hasError = true; } 
            else { if (referralFriendEmailInput) referralFriendEmailInput.style.borderColor = '#444'; }

            if (!friendPhone) { if (referralFriendPhoneInput) referralFriendPhoneInput.style.borderColor = '#E50914'; hasError = true; } 
            else { if (referralFriendPhoneInput) referralFriendPhoneInput.style.borderColor = '#444'; }

            if (hasError) return;

            const adminNumber = "5016542016"; const userEmail = window.currentUserEmail || "Unknown Email";
            const message = `Hey Admin! I want to invite a friend to AYMovies!\n\n*My Account:* ${userEmail}\n\n*Friend's Details:*\n📧 Email: ${friendEmail}\n📱 Phone: ${friendPhone}\n\nPlease set up an account for my friend. Once they pay/join, please add $0.50 BZD to my Rewards Wallet, Thanks!`;
            const waUrl = `https://wa.me/${adminNumber}?text=${encodeURIComponent(message)}`;
            const nativeWaUrl = `whatsapp://send?phone=${adminNumber}&text=${encodeURIComponent(message)}`;

            if (window.AppInventor && typeof window.AppInventor.setWebViewString === 'function') { window.AppInventor.setWebViewString(nativeWaUrl); } 
            else { window.open(waUrl, '_blank'); }
        });
    }
});

// ==========================================
// 🖱️ AYMOVIES TRUE BROWSER MOUSE ENGINE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    const styleFix = document.createElement('style');
    styleFix.innerHTML = `
        .slider-arrow, .row-arrow { opacity: 0.8 !important; }
        
        /* 🚫 KILL ALL WHITE BORDERS AND SCROLLBARS */
        body, html { 
            margin: 0 !important; 
            padding: 0 !important; 
            overflow-x: hidden !important; 
            scrollbar-width: none !important; 
            -ms-overflow-style: none !important; 
        }
        
        ::-webkit-scrollbar { 
            display: none !important; 
            width: 0px !important; 
            background: transparent !important; 
        }
    `;
    document.head.appendChild(styleFix);

    // 📱 MOBILE VIDEO MODAL FIT FIX (No Scrolling Required)
    const mobileLayoutFix = document.createElement('style');
    mobileLayoutFix.innerHTML = `
        #video-modal {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
            background: #000000 !important;
            overflow: hidden !important;
            z-index: 999999 !important;
        }

        #native-video-player {
            width: 100% !important;
            height: 100% !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            object-fit: contain !important;
        }
    `;
    document.head.appendChild(mobileLayoutFix);

    const cursor = document.createElement('div');
    cursor.id = 'tv-virtual-cursor';
    cursor.style.cssText = `
        position: fixed; top: 50%; left: 50%; 
        width: 35px; height: 35px; 
        background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='35' height='35' viewBox='0 0 24 24' fill='%23E50914' stroke='white' stroke-width='1.5'><path d='M7 2l12 11.2-5.8.5 3.3 7.3-2.2.9-3.2-7.4-4.4 4.7z'/></svg>") no-repeat; 
        z-index: 9999999; pointer-events: none; 
        transition: opacity 0.4s ease-out; 
        filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.8));
        opacity: 0;
    `;
    document.body.appendChild(cursor);

    let posX = window.innerWidth / 2;
    let posY = window.innerHeight / 2;
    const speed = 15; 

    let lastActivityTime = Date.now();

    setInterval(() => {
        if (Date.now() - lastActivityTime >= 3000) {
            cursor.style.opacity = '0';
        }
    }, 500);

    function registerActivity() {
        lastActivityTime = Date.now();
        cursor.style.opacity = '1';
    }

    let autoScrollInterval = null;
    let scrollState = { targetX: null, dx: 0 };

    function executeScroll() {
        if (scrollState.targetX) scrollState.targetX.scrollBy({ left: scrollState.dx, behavior: 'auto' });
    }

    function evaluateHoverZone(x, y) {
        cursor.style.display = 'none'; 
        const target = document.elementFromPoint(x + 5, y + 5);
        cursor.style.display = 'block';

        let dx = 0;
        let targetX = null;

        if (target) {
            const leftArrow = target.closest('.left-arrow');
            const rightArrow = target.closest('.right-arrow');
            const movieRow = target.closest('.movie-row') || target.closest('.row-wrapper');

            if (leftArrow) { targetX = leftArrow.parentElement.querySelector('.movie-row'); dx = -15; } 
            else if (rightArrow) { targetX = rightArrow.parentElement.querySelector('.movie-row'); dx = 15; } 
            else if (movieRow) {
                const rowElem = movieRow.classList.contains('movie-row') ? movieRow : movieRow.querySelector('.movie-row');
                if (rowElem) {
                    const rect = rowElem.getBoundingClientRect();
                    if (x < rect.left + 80) { targetX = rowElem; dx = -15; }
                    else if (x > rect.right - 80) { targetX = rowElem; dx = 15; }
                }
            }
        }

        scrollState = { targetX, dx };

        if (dx !== 0 && !autoScrollInterval) autoScrollInterval = setInterval(executeScroll, 30);
        else if (dx === 0 && autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; }
    }

    document.addEventListener('mousemove', (e) => {
        posX = e.clientX; posY = e.clientY;
        cursor.style.left = posX + 'px'; cursor.style.top = posY + 'px';
        evaluateHoverZone(posX, posY);
    });

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            posX = e.touches[0].clientX; posY = e.touches[0].clientY;
            cursor.style.left = posX + 'px'; cursor.style.top = posY + 'px';
            evaluateHoverZone(posX, posY);
        }
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
        const key = e.key;
        const keyCode = e.keyCode || e.which;
        let moved = false;

        // SEARCH FIX: If actively typing in input/textarea, let native keyboard handle keys
        if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            if (key === 'Enter' || keyCode === 13) {
                const form = document.activeElement.closest('form');
                if (form) {
                    const submitBtn = form.querySelector('button[type="submit"]');
                    if (submitBtn) submitBtn.click();
                }
            }
            return;
        }

        if ([37, 38, 39, 40].includes(keyCode)) {
            e.preventDefault(); e.stopPropagation(); 
        }

        if (key === 'ArrowUp' || keyCode === 38) { posY -= speed; moved = true; }
        else if (key === 'ArrowDown' || keyCode === 40) { posY += speed; moved = true; }
        else if (key === 'ArrowLeft' || keyCode === 37) { posX -= speed; moved = true; }
        else if (key === 'ArrowRight' || keyCode === 39) { posX += speed; moved = true; }
        
        else if (key === 'Enter' || key === 'Select' || keyCode === 13 || keyCode === 23 || keyCode === 66) {
            registerActivity(); 
            e.preventDefault(); e.stopPropagation();
            
            const tipX = posX + 7; const tipY = posY + 2;
            
            cursor.style.display = 'none'; 
            const target = document.elementFromPoint(tipX, tipY);
            cursor.style.display = 'block';

            if (target) {
                if (target.tagName === 'VIDEO') {
                    const rect = target.getBoundingClientRect();
                    const clickX = tipX - rect.left;
                    const clickY = tipY - rect.top;

                    if (clickY > rect.height - 80) {
                        if (clickX < 100) { if (target.paused) target.play(); else target.pause(); }
                        else {
                            const percentage = clickX / rect.width;
                            if (target.duration) target.currentTime = percentage * target.duration;
                        }
                    } else {
                        if (target.paused) target.play(); else target.pause();
                    }
                    return; 
                }

                if (target.tagName === 'SELECT' || target.closest('select')) {
                    const selectBox = target.tagName === 'SELECT' ? target : target.closest('select');
                    selectBox.focus();
                    return;
                }

                const inputParent = target.closest('input, textarea');
                if (inputParent) {
                    inputParent.focus();
                    return;
                }

                const clickEvent = new MouseEvent('click', {
                    view: window, bubbles: true, cancelable: true, clientX: tipX, clientY: tipY
                });
                target.dispatchEvent(clickEvent);

                const clickableParent = target.closest('button, a, .movie-card, .chip-btn, .hero-dot');
                if (clickableParent && clickableParent !== target) {
                    clickableParent.dispatchEvent(new MouseEvent('click', {
                        view: window, bubbles: true, cancelable: true, clientX: tipX, clientY: tipY
                    }));
                }
            }
        }

        if (moved) {
            registerActivity(); 
            
            if (posX < 0) posX = 0; if (posY < 0) posY = 0;
            if (posX > window.innerWidth - 30) posX = window.innerWidth - 30;
            if (posY > window.innerHeight - 30) posY = window.innerHeight - 30;

            cursor.style.left = posX + 'px'; cursor.style.top = posY + 'px';

            let deltaY = 0;
            if (posY > window.innerHeight - 80) deltaY = speed * 2;
            if (posY < 80) deltaY = -speed * 2;

            if (deltaY !== 0) {
                let scrolledModal = false;

                const detailsModal = document.getElementById('details-modal');
                const actorModal = document.getElementById('actor-modal');
                const rewardsDrawer = document.getElementById('rewards-drawer');
                const mobileMenu = document.getElementById('mobile-menu');
                const searchDropdown = document.getElementById('search-dropdown');

                if (detailsModal && detailsModal.style.display === 'block') {
                    detailsModal.scrollBy({ top: deltaY, behavior: 'auto' });
                    const inners = detailsModal.querySelectorAll('.details-content, .modal-content');
                    inners.forEach(el => el.scrollBy({ top: deltaY, behavior: 'auto' }));
                    scrolledModal = true;
                } 
                else if (actorModal && actorModal.style.display === 'block') {
                    actorModal.scrollBy({ top: deltaY, behavior: 'auto' });
                    const inners = actorModal.querySelectorAll('.details-content, .modal-content, .actor-content, .scrollable');
                    inners.forEach(el => el.scrollBy({ top: deltaY, behavior: 'auto' }));
                    scrolledModal = true;
                } 
                else if (rewardsDrawer && (rewardsDrawer.style.right === '0px' || rewardsDrawer.style.right === '0')) {
                    rewardsDrawer.scrollBy({ top: deltaY, behavior: 'auto' });
                    scrolledModal = true;
                } 
                else if (mobileMenu && (mobileMenu.style.right === '0px' || mobileMenu.style.right === '0')) {
                    mobileMenu.scrollBy({ top: deltaY, behavior: 'auto' });
                    scrolledModal = true;
                } 
                else if (searchDropdown && searchDropdown.style.display === 'block') {
                    searchDropdown.scrollBy({ top: deltaY, behavior: 'auto' });
                    scrolledModal = true;
                }

                if (!scrolledModal) {
                    window.scrollBy({ top: deltaY, behavior: 'auto' });
                }
            }

            evaluateHoverZone(posX, posY);
        }
    }, true);
});
