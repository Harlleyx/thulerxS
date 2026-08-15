import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc as firestoreDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// SUAS CREDENCIAIS DO FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyDjzc-lFAujv5s3A5LHR23qPKXN90exAJw",
  authDomain: "thulerx-store.firebaseapp.com",
  projectId: "thulerx-store",
  storageBucket: "thulerx-store.firebasestorage.app",
  messagingSenderId: "930067642720",
  appId: "1:930067642720:web:5c4281e9b99fc3714e4605"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Produtos: agora vêm do Firestore (coleção "products") em tempo real.
// Essa lista começa vazia e é preenchida pela função loadProductsFromFirestore().
let products = [];

let cart = [];
let currentCategory = 'todas';
let searchQuery = '';
let activeChatId = localStorage.getItem('thulerx_chat_id') || null;
let unsubscribeMessages = null;
let chatStatusUnsubscribe = null;
let selectedRating = 5;

// Inicialização da Vitrine
document.addEventListener('DOMContentLoaded', () => {
    loadProductsFromFirestore();
    updateCartUI();
    loadPublicReviews();

    if (activeChatId) {
        reconnectExistingChat();
    }
});

// Escuta a coleção "products" no Firestore em tempo real.
// Toda vez que o estoque mudar no banco (venda confirmada, ajuste manual
// pela equipe, etc), a vitrine é re-renderizada automaticamente — sem
// precisar editar código nem publicar nada de novo.
function loadProductsFromFirestore() {
    const productsRef = collection(db, "products");

    onSnapshot(productsRef, (snapshot) => {
        products = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }));

        // NOVO: sempre que o estoque mudar no banco, sincroniza as
        // quantidades já presentes no carrinho para não deixar o cliente
        // com mais itens no carrinho do que existe em estoque.
        syncCartWithStock();

        renderCategories();
        renderProducts();
    }, (error) => {
        console.error("Erro ao carregar produtos:", error);
        showToast("Erro ao carregar produtos. Recarregue a página.", "❌");
    });
}

// NOVO: revalida o carrinho contra o estoque atual do Firestore.
// Se o estoque de um produto diminuiu (outra pessoa comprou, equipe
// ajustou etc) e o carrinho tinha mais unidades do que isso, a
// quantidade é reduzida automaticamente (ou o item removido, se o
// estoque zerou).
function syncCartWithStock() {
    if (cart.length === 0) return;

    let changed = false;

    cart = cart.filter(item => {
        const current = products.find(p => p.id === item.id);

        if (!current || current.stock === 0) {
            changed = true;
            return false; // remove item esgotado/removido do carrinho
        }

        if (item.quantity > current.stock) {
            item.quantity = current.stock;
            changed = true;
        }

        // mantém o "stock" do item do carrinho sempre atualizado
        item.stock = current.stock;

        return true;
    });

    if (changed) {
        showToast('Seu carrinho foi ajustado conforme o estoque disponível.', '⚠️');
        updateCartUI();
    }
}

// Toast / Notificações
window.showToast = function(message, icon = '✅') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-100 text-xs px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-4 opacity-0';
    toast.innerHTML = `<span class="text-base">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// Autenticação
onAuthStateChanged(auth, (user) => {
    const loginBtnContainer = document.getElementById('auth-btn-container');
    if (!loginBtnContainer) return;

if (user) {
        loginBtnContainer.innerHTML = `
            <button onclick="openProfileModal()" title="${user.displayName || 'Meu Perfil'}" class="w-10 h-10 rounded-full overflow-hidden border-2 border-slate-700 hover:border-blue-500 transition active:scale-90">
                <img src="${user.photoURL || 'https://via.placeholder.com/40'}" alt="Perfil" class="w-full h-full object-cover">
            </button>
        `;
    } else {
        loginBtnContainer.innerHTML = `
            <button onclick="loginWithGoogle()" class="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white transition shadow-md shadow-blue-600/20">
                <span>Entrar</span>
            </button>
        `;
    }
});

function renderCategories() {
    const categoriesSet = new Set(products.map(p => p.category));
    const container = document.getElementById('category-filter');
    if (!container) return;
    
    container.innerHTML = `<button onclick="filterCategory('todas')" class="px-4 py-1.5 ${currentCategory === 'todas' ? 'bg-blue-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} border border-slate-700/60 rounded-full text-xs transition">Todas</button>`;

    categoriesSet.forEach(cat => {
        const isActive = currentCategory === cat;
        container.innerHTML += `
            <button onclick="filterCategory('${cat}')" class="px-4 py-1.5 ${isActive ? 'bg-blue-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} border border-slate-700/60 rounded-full text-xs whitespace-nowrap transition">${cat}</button>
        `;
    });
}

window.filterCategory = function(cat) {
    currentCategory = cat;
    renderCategories();
    renderProducts();
};

window.handleSearch = function(e) {
    searchQuery = e.target.value.toLowerCase().trim();
    renderProducts();
};

function renderProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let filtered = products.filter(p => {
        const matchesCategory = currentCategory === 'todas' || p.category === currentCategory;
        const matchesSearch = p.name.toLowerCase().includes(searchQuery);
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 text-sm">Nenhum produto encontrado com os filtros selecionados.</div>`;
        return;
    }

    filtered.forEach(product => {
        const discountPercentage = product.oldPrice ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0;

        grid.innerHTML += `
            <div class="group bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300">
                <div>
                    <!-- Imagem com Badge de Desconto -->
                    <div class="relative overflow-hidden rounded-xl mb-3 bg-slate-900">
                        <img src="${product.image}" alt="${product.name}" class="w-full aspect-square object-cover group-hover:scale-105 transition duration-500">
                        ${discountPercentage > 0 ? `<span class="absolute top-2 left-2 bg-red-700 text-white font-black text-[10px] px-2 py-0.5 rounded-md shadow-md">-${discountPercentage}%</span>` : ''}
                        <span class="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-md text-slate-300 text-[10px] px-2 py-0.5 rounded-md font-medium border border-slate-700/50">${product.category}</span>
                    </div>

                    <!-- Estoque -->
                    <div class="flex items-center gap-1.5 mb-1">
                        <span class="w-2 h-2 rounded-full ${product.stock > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span>
                        <span class="text-[11px] font-medium ${product.stock > 0 ? 'text-emerald-400' : 'text-red-400'}">
                            ${product.stock > 0 ? `Em estoque (${product.stock} un)` : 'Esgotado'}
                        </span>
                    </div>

                    <h3 class="font-bold text-sm text-slate-100 group-hover:text-blue-400 transition">${product.name}</h3>
                    
                    <!-- Preço com De / Por -->
                    <div class="mt-1 flex items-baseline gap-2">
                        <p class="text-blue-400 font-black text-[20px]">R$ ${product.price.toFixed(2).replace('.', ',')}</p>
                        ${product.oldPrice ? `<p class="text-slate-500 text-xs line-through">R$ ${product.oldPrice.toFixed(2).replace('.', ',')}</p>` : ''}
                    </div>
                </div>

<!-- Botões -->
<div class="grid grid-cols-[auto_1fr] gap-2 mt-4">
<button
    onclick='handleAddToCart(${JSON.stringify(product)})'
    ${product.stock === 0 ? 'disabled' : ''}
    class="bg-slate-800 hover:bg-slate-700 w-12 h-12 rounded-xl flex items-center justify-center transition ${product.stock === 0 ? 'opacity-40 cursor-not-allowed hover:bg-slate-800' : ''}"
>
    <img src="/addcart.png" width="20" height="20" />
</button>
<button
    onclick='${product.stock === 0 ? '' : `handleBuy(${JSON.stringify(product)})`}'
    ${product.stock === 0 ? 'disabled' : ''}
    class="${product.stock === 0 ? 'bg-slate-700 cursor-not-allowed opacity-50' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20'} text-white text-sm py-3 px-4 rounded-xl font-semibold transition text-center"
>
    ${product.stock === 0 ? 'Esgotado' : 'Comprar'}
</button>
</div>
            </div>
        `;
    });
}

window.handleAddToCart = function(product) {
    if (product.stock === 0) {
        showToast('Produto esgotado!', '⛔');
        return;
    }
    addToCart(product);
};

window.handleBuy = function(product) {
    if (product.stock === 0) {
        showToast('Produto esgotado!', '⛔');
        return;
    }
    if (!cart.some(item => item.id === product.id)) {
        addToCart(product, { silent: true });
    }
    toggleCart();
};

// CORRIGIDO: agora respeita o limite de estoque do produto ao adicionar
// ou incrementar um item já existente no carrinho. Antes disso não
// existia nenhuma checagem aqui, então dava para adicionar quantas
// unidades quisesse independente do que havia disponível.
function addToCart(product, opts = {}) {
    const existing = cart.find(item => item.id === product.id);

    if (existing) {
        if (existing.quantity >= product.stock) {
            showToast('Quantidade máxima em estoque atingida!', '⚠️');
            updateCartUI();
            return;
        }
        existing.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }

    updateCartUI();

    if (!opts.silent) {
        showToast(`<strong>${product.name}</strong> adicionado!`, '🛒');
    }
}

function updateCartUI() {
    const countSpan = document.getElementById('cart-count');
    const itemsContainer = document.getElementById('cart-items');
    const totalSpan = document.getElementById('cart-total');

    if (!countSpan || !itemsContainer || !totalSpan) return;

    const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    countSpan.textContent = totalCount;

    if (cart.length === 0) {
        itemsContainer.innerHTML = `<p class="text-slate-500 text-center py-8 text-xs">Seu carrinho está vazio.</p>`;
        totalSpan.textContent = `R$ 0,00`;
        return;
    }

    itemsContainer.innerHTML = '';
    let totalPrice = 0;

    cart.forEach(item => {
        totalPrice += item.price * item.quantity;

        // CORRIGIDO: os IDs agora vêm do Firestore e são strings
        // (ex: "aB3xY9k"), não números. Sem as aspas em volta de
        // ${item.id}, o HTML gerado virava algo como
        // onclick="increaseQuantity(aB3xY9k)" — o navegador tentava ler
        // aB3xY9k como uma variável JS inexistente e a chamada falhava
        // silenciosamente. Com produtos antigos de ID numérico (1, 2...)
        // isso não dava erro, por isso funcionava antes.
        const atMax = item.quantity >= item.stock;

        itemsContainer.innerHTML += `
            <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl flex justify-between items-center">
                <div>
                    <h4 class="font-bold text-xs text-slate-200">${item.name}</h4>
                    <p class="text-xs text-blue-400 font-semibold mt-0.5">R$ ${item.price.toFixed(2).replace('.', ',')}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="decreaseQuantity('${item.id}')" class="bg-slate-800 hover:bg-slate-700 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-slate-300">-</button>
                    <span class="text-xs font-bold w-4 text-center text-slate-200">${item.quantity}</span>
                    <button onclick="increaseQuantity('${item.id}')" ${atMax ? 'disabled' : ''} class="bg-slate-800 hover:bg-slate-700 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-slate-300 ${atMax ? 'opacity-40 cursor-not-allowed hover:bg-slate-800' : ''}">+</button>
                    <button onclick="removeItem('${item.id}')" class="text-slate-500 hover:text-red-400 ml-2 text-xs">🗑️</button>
                </div>
            </div>
        `;
    });

    totalSpan.textContent = `R$ ${totalPrice.toFixed(2).replace('.', ',')}`;
}

// CORRIGIDO: comparação de string com string agora funciona porque o
// onclick no HTML passa o ID entre aspas (veja updateCartUI acima).
window.increaseQuantity = function(id) {
    const item = cart.find(i => i.id === id);
    if (!item) return;

    // CORRIGIDO: trava no limite do estoque em vez de incrementar sem fim.
    if (item.quantity >= item.stock) {
        showToast('Quantidade máxima em estoque atingida!', '⚠️');
        return;
    }

    item.quantity++;
    updateCartUI();
};

window.decreaseQuantity = function(id) {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.quantity--;
        if (item.quantity <= 0) {
            cart = cart.filter(i => i.id !== id);
        }
    }
    updateCartUI();
};

window.removeItem = function(id) {
    cart = cart.filter(i => i.id !== id);
    updateCartUI();
};

window.toggleCart = function() {
    const modal = document.getElementById('cart-modal');
    if (!modal) return;
    modal.classList.toggle('hidden');
    modal.classList.toggle('flex');
};

// ABRIR O CHECKOUT (Exibe o PIX e esconde o CHAT por padrão)
window.openCheckout = function() {
    if (cart.length === 0) {
        showToast('Seu carrinho está vazio!', '⚠️');
        return;
    }
    toggleCart();

    const checkoutModal = document.getElementById('checkout-modal');
    const pixSec = document.getElementById('pix-section');
    const chatSec = document.getElementById('client-chat-section');

    // Força exibir o PIX e esconder o CHAT ao abrir o pagamento
    if (pixSec) pixSec.classList.remove('hidden');
    if (chatSec) chatSec.classList.add('hidden');

    if (!checkoutModal) return;
    checkoutModal.classList.remove('hidden');
    checkoutModal.classList.add('flex');
};

window.closeCheckout = function() {
    const checkoutModal = document.getElementById('checkout-modal');
    if (!checkoutModal) return;
    checkoutModal.classList.add('hidden');
    checkoutModal.classList.remove('flex');
};

window.copyPixKey = function() {
    const keyInput = document.getElementById('pix-key');
    if (!keyInput) return;
    keyInput.select();
    navigator.clipboard.writeText(keyInput.value);
    showToast('Chave Pix copiada com sucesso!', '📋');
};

// NOVO: valida o link do comprovante antes de abrir o atendimento
window.handleConfirmPayment = function() {
    const linkInput = document.getElementById('payment-proof-link');
    const link = linkInput ? linkInput.value.trim() : '';

    if (!link) {
        showToast('Cole o link do comprovante antes de continuar!', '⚠️');
        return;
    }

    try {
        new URL(link);
    } catch {
        showToast('O link do comprovante parece inválido!', '⚠️');
        return;
    }

    window.paymentProofLink = link;
    confirmPayment();
};

// BOTÃO "JÁ PAGUEI" -> Troca o Pix pelo Chat, mostra o botão flutuante e envia o pedido pro Firestore
window.confirmPayment = async function() {
    const user = auth.currentUser;
    if (!user) {
        showToast("Faça login para abrir o suporte!", "🔑");
        const loggedUser = await window.loginWithGoogle();
        if (!loggedUser) return; // login falhou ou popup foi fechado
    }

    if (cart.length === 0 && !activeChatId) {
        showToast("Adicione produtos ao carrinho antes de continuar!", "⚠️");
        return;
    }

    try {
        if (!activeChatId) {
            const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            const chatRef = await addDoc(collection(db, "chats"), {
                clientId: auth.currentUser.uid,
                clientName: auth.currentUser.displayName || "Cliente Thulerx",
                clientEmail: auth.currentUser.email || "",
                items: cart,
                totalAmount: totalPrice,
                proofLink: window.paymentProofLink || "",
                status: "active",
                createdAt: serverTimestamp()
            });

            activeChatId = chatRef.id;
            localStorage.setItem('thulerx_chat_id', activeChatId);

            if (window.paymentProofLink) {
                await addDoc(collection(db, "chats", activeChatId, "messages"), {
                    sender: 'client',
                    text: `📎 Comprovante de pagamento: ${window.paymentProofLink}`,
                    timestamp: serverTimestamp()
                });
            }

            cart = [];
            updateCartUI();

            const linkInput = document.getElementById('payment-proof-link');
            if (linkInput) linkInput.value = '';
            window.paymentProofLink = null;
        }

        const pixSec = document.getElementById('pix-section');
        const chatSec = document.getElementById('client-chat-section');
        if (pixSec) pixSec.classList.add('hidden');
        if (chatSec) chatSec.classList.remove('hidden');

        const floatBtn = document.getElementById('floating-chat-btn');
        if (floatBtn) {
            floatBtn.classList.remove('hidden');
            floatBtn.classList.add('flex');
        }

        loadClientMessages(activeChatId);
        monitorChatStatus(activeChatId);
        showToast('Atendimento iniciado com sucesso!', '💬');
    } catch (error) {
        console.error("Erro ao iniciar chat: ", error);
        showToast("Erro ao abrir atendimento. Tente novamente.", "❌");
    }
};

// Abrir diretamente o chat ativo pelo botão flutuante
window.openActiveChat = function() {
    if (!activeChatId) return;

    const checkoutModal = document.getElementById('checkout-modal');
    const pixSec = document.getElementById('pix-section');
    const chatSec = document.getElementById('client-chat-section');

    if (pixSec) pixSec.classList.add('hidden');
    if (chatSec) chatSec.classList.remove('hidden');

    if (checkoutModal) {
        checkoutModal.classList.remove('hidden');
        checkoutModal.classList.add('flex');
    }
};

// CORRIGIDO: antes de reexibir o botão flutuante ao carregar a página,
// verifica no Firestore se o atendimento salvo no localStorage ainda está
// realmente ATIVO. Se não estiver (fechado, cancelado ou não existe mais),
// limpa o localStorage e NÃO mostra o botão — em vez de mostrá-lo direto.
async function reconnectExistingChat() {
    try {
        const chatDocRef = firestoreDoc(db, "chats", activeChatId);
        const chatSnap = await getDoc(chatDocRef);

        if (!chatSnap.exists()) {
            localStorage.removeItem('thulerx_chat_id');
            activeChatId = null;
            return;
        }

        const data = chatSnap.data();

        if (data.status !== 'active') {
            // Atendimento foi encerrado ou cancelado enquanto o cliente
            // estava fora: mostra a avaliação/aviso de cancelamento agora.
            const reviewModal = document.getElementById('review-modal');
            const reviewContent = document.getElementById('review-modal-content');
            const canceledContent = document.getElementById('canceled-order-content');

            if (reviewModal) {
                if (data.status === 'canceled' || data.status === 'cancelled') {
                    if (reviewContent) reviewContent.classList.add('hidden');
                    if (canceledContent) canceledContent.classList.remove('hidden');
                } else {
                    if (reviewContent) reviewContent.classList.remove('hidden');
                    if (canceledContent) canceledContent.classList.add('hidden');
                }
                reviewModal.classList.remove('hidden');
                reviewModal.classList.add('flex');
            }

            localStorage.removeItem('thulerx_chat_id');
            activeChatId = null;
            return;
        }

        // Só chega aqui se o atendimento realmente está ativo no Firestore
        const floatBtn = document.getElementById('floating-chat-btn');
        if (floatBtn) {
            floatBtn.classList.remove('hidden');
            floatBtn.classList.add('flex');
            floatBtn.onclick = window.openActiveChat;
        }
        monitorChatStatus(activeChatId);
        loadClientMessages(activeChatId);
    } catch (error) {
        console.error("Erro ao reconectar atendimento:", error);
    }
}

function monitorChatStatus(chatId) {
    if (chatStatusUnsubscribe) chatStatusUnsubscribe();

    const chatDocRef = firestoreDoc(db, "chats", chatId);
    chatStatusUnsubscribe = onSnapshot(chatDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();

            renderChatOrderSummary(data);

            if (data.status === 'closed' || data.status === 'canceled' || data.status === 'cancelled') {
                const checkoutModal = document.getElementById('checkout-modal');
                if (checkoutModal) checkoutModal.classList.add('hidden');

                const floatBtn = document.getElementById('floating-chat-btn');
                if (floatBtn) floatBtn.classList.add('hidden');

                localStorage.removeItem('thulerx_chat_id');
                activeChatId = null; // NOVO: limpa também a variável em memória
                if (unsubscribeMessages) unsubscribeMessages();
                if (chatStatusUnsubscribe) chatStatusUnsubscribe(); // NOVO: para de ouvir esse chat encerrado

                const reviewModal = document.getElementById('review-modal');
                const reviewContent = document.getElementById('review-modal-content');
                const canceledContent = document.getElementById('canceled-order-content');

                if (reviewModal) {
                    if (data.status === 'canceled' || data.status === 'cancelled') {
                        if (reviewContent) reviewContent.classList.add('hidden');
                        if (canceledContent) canceledContent.classList.remove('hidden');
                    } else {
                        if (reviewContent) reviewContent.classList.remove('hidden');
                        if (canceledContent) canceledContent.classList.add('hidden');
                    }
                    reviewModal.classList.remove('hidden');
                    reviewModal.classList.add('flex');
                }
            }
        }
    });
}

function renderChatOrderSummary(chatData) {
    const listContainer = document.getElementById('chat-purchased-items-list');
    const statusSpan = document.getElementById('chat-order-status');

    if (statusSpan && chatData.status) {
        if (chatData.status === 'active') {
            statusSpan.textContent = "Em Andamento";
            statusSpan.className = "text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md border border-blue-500/20";
        } else if (chatData.status === 'closed') {
            statusSpan.textContent = "Concluído";
            statusSpan.className = "text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-md border border-emerald-500/20";
        } else if (chatData.status === 'canceled') {
            statusSpan.textContent = "Cancelado";
            statusSpan.className = "text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-md border border-red-500/20";
        }
    }

    if (!listContainer || !chatData.items) return;

    listContainer.innerHTML = chatData.items.map(item => `
        <div class="flex justify-between items-center text-[11px]">
            <span>${item.quantity}x ${item.name}</span>
            <span class="font-bold text-slate-300">R$ ${(item.price * item.quantity).toFixed(2).replace('.', ',')}</span>
        </div>
    `).join('');
}

function loadClientMessages(chatId) {
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    if (unsubscribeMessages) unsubscribeMessages();

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        const messagesDiv = document.getElementById('chat-messages');
        if (!messagesDiv) return;
        messagesDiv.innerHTML = '';

        if (snapshot.empty) {
            messagesDiv.innerHTML = `<p class="text-slate-500 text-center my-auto text-xs">Aguardando mensagem. Envie sua confirmação!</p>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const isClient = msg.sender === 'client';
            messagesDiv.innerHTML += `
                <div class="p-2.5 rounded-xl max-w-[85%] text-xs ${isClient ? 'bg-blue-600/30 border border-blue-500/30 self-end text-slate-100' : 'bg-slate-800 border border-slate-700 self-start text-slate-200'}">
                    <b>${isClient ? 'Você' : 'Suporte'}:</b> ${msg.text}
                </div>
            `;
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

window.sendClientMessage = async function() {
    const input = document.getElementById('client-message-input');
    if (!input || !input.value.trim() || !activeChatId) return;

    const text = input.value;
    input.value = '';

    try {
        await addDoc(collection(db, "chats", activeChatId, "messages"), {
            sender: 'client',
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Erro ao enviar mensagem: ", error);
    }
};

window.loginWithGoogle = async function() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        showToast(`Bem-vindo, ${result.user.displayName}!`, '👋');
        return result.user;
    } catch (error) {
        console.error("Erro no login:", error);
        return null;
    }
};

window.logoutUser = async function() {
    try {
        await signOut(auth);
        window.closeProfileModal();
        showToast("Você saiu da sua conta.", "ℹ️");
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
};

window.setRating = function(rating) {
    selectedRating = rating;
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach((star, index) => {
        star.classList.toggle('text-amber-400', index < rating);
        star.classList.toggle('text-slate-600', index >= rating);
    });
};

window.submitClientReview = async function() {
    const commentInput = document.getElementById('review-comment-input');
    const comment = commentInput ? commentInput.value.trim() : "";
    
    let currentUser = auth.currentUser;
    if (!currentUser) {
        currentUser = await window.loginWithGoogle();
        if (!currentUser) return;
    }
    
    try {
        await addDoc(collection(db, "reviews"), {
            uid: currentUser.uid,
            clientName: currentUser.displayName || "Cliente",
            rating: selectedRating,
            comment: comment || "Excelente atendimento e envio rápido!",
            timestamp: serverTimestamp()
        });

        const reviewModal = document.getElementById('review-modal');
        if (reviewModal) reviewModal.classList.add('hidden');
        showToast("Obrigado pela sua avaliação!", "⭐");
        activeChatId = null;
    } catch (error) {
        console.error("Erro ao enviar avaliação:", error);
    }
};

function loadPublicReviews() {
    const reviewsRef = collection(db, "reviews");
    const q = query(reviewsRef, orderBy("timestamp", "desc"));

    onSnapshot(q, (snapshot) => {
        const grid = document.getElementById('public-reviews-grid');
        if (!grid) return;
        
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `<p class="text-xs text-slate-500 col-span-full text-center py-4">Nenhuma avaliação ainda. Seja o primeiro a comprar!</p>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const rev = docSnap.data();
            const starsHTML = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
            const initial = rev.clientName ? rev.clientName.charAt(0).toUpperCase() : 'C';
            
            grid.innerHTML += `
                <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg flex flex-col justify-between hover:border-slate-700 transition duration-300">
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-xs">
                                    ${initial}
                                </div>
                                <div>
                                    <h4 class="font-bold text-xs text-slate-100">${rev.clientName}</h4>
                                    <span class="text-[10px] text-emerald-400 font-medium flex items-center gap-1">✓ Compra Verificada</span>
                                </div>
                            </div>
                            <span class="text-amber-400 text-xs font-bold tracking-widest">${starsHTML}</span>
                        </div>
                        <p class="text-xs text-slate-300 leading-relaxed italic">"${rev.comment}"</p>
                    </div>
                </div>
            `;
        });
    });
}

window.openProfileModal = async function() {
    const user = auth.currentUser;
    if (!user) {
        await window.loginWithGoogle();
        return;
    }

    const profileModal = document.getElementById('profile-modal');
    if (!profileModal) return;

    document.getElementById('profile-avatar').src = user.photoURL || 'https://via.placeholder.com/64';
    document.getElementById('profile-name').textContent = user.displayName || 'Usuário';
    document.getElementById('profile-email').textContent = user.email || '';

    await loadUserProfileData(user.uid);

    profileModal.classList.remove('hidden');
    profileModal.classList.add('flex');
};

window.closeProfileModal = function() {
    const profileModal = document.getElementById('profile-modal');
    if (!profileModal) return;
    profileModal.classList.add('hidden');
};

async function loadUserProfileData(uid) {
    const historyContainer = document.getElementById('profile-history-list');
    const countContainer = document.getElementById('profile-purchase-count');
    if (!historyContainer) return;

    historyContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Carregando...</p>`;

    try {
        const chatsRef = collection(db, "chats");
        const qChats = query(chatsRef, where("clientId", "==", uid));
        const chatSnapshot = await getDocs(qChats);

        if (chatSnapshot.empty) {
            historyContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Você ainda não tem histórico de compras/atendimentos.</p>`;
            if (countContainer) countContainer.textContent = "0 compras";
            return;
        }

        historyContainer.innerHTML = '';
        let totalPurchases = 0;

        chatSnapshot.forEach((docSnap) => {
            const chat = docSnap.data();
            if (chat.status === 'closed') {
                totalPurchases++;
            }

            let statusText = 'Em andamento';
            let statusColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';

            if (chat.status === 'closed') {
                statusText = 'Concluído';
                statusColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            } else if (chat.status === 'canceled') {
                statusText = 'Cancelado';
                statusColor = 'text-red-400 bg-red-500/10 border-red-500/20';
            }

            const total = chat.totalAmount ? `R$ ${chat.totalAmount.toFixed(2).replace('.', ',')}` : '';

            historyContainer.innerHTML += `
                <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl flex justify-between items-center text-xs">
                    <div>
                        <span class="font-bold text-slate-200">Pedido #${docSnap.id.substring(0, 6)}</span>
                        ${total ? `<span class="text-slate-400 ml-2">(${total})</span>` : ''}
                        <p class="text-slate-400 text-[10px] mt-1">Status: <span class="px-2 py-0.5 rounded font-semibold border ${statusColor}">${statusText}</span></p>
                    </div>
                </div>
            `;
        });

        if (countContainer) {
            countContainer.textContent = `${totalPurchases} ${totalPurchases === 1 ? 'compra' : 'compras'}`;
        }
    } catch (error) {
        console.error("Erro ao carregar perfil:", error);
    }
}
