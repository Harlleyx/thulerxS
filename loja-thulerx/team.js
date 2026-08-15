import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ⚠️ SUAS CREDENCIAIS DO FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDjzc-lFAujv5s3A5LHR23qPKXN90exAJw",
    authDomain: "thulerx-store.firebaseapp.com",
    projectId: "thulerx-store",
    storageBucket: "thulerx-store.firebasestorage.app",
    messagingSenderId: "930067642720",
    appId: "1:930067642720:web:5c4281e9b99fc3714e4605"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentActiveChatId = null;
let teamUnsubscribeMessages = null;
let chatsUnsubscribe = null;

// Monitorar estado de autenticação (Segurança da Área da Equipe)
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('login-screen')?.classList.add('hidden');
        document.getElementById('dashboard-screen')?.classList.remove('hidden');
        const userEmailEl = document.getElementById('logged-user-email');
        if (userEmailEl) userEmailEl.textContent = user.email;
        
        loadActiveChatsList();
        loadTeamChat(); // Inicia o chat interno da equipe ao logar
    } else {
        document.getElementById('dashboard-screen')?.classList.add('hidden');
        document.getElementById('login-screen')?.classList.remove('hidden');
    }
});

window.handleTeamLogin = async function(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        alert("Erro ao entrar: E-mail ou senha incorretos ou sem permissão.");
        console.error(error);
    }
}

window.logoutTeam = async function() {
    try {
        if (chatsUnsubscribe) chatsUnsubscribe();
        if (teamUnsubscribeMessages) teamUnsubscribeMessages();
        await signOut(auth);
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
}

function loadActiveChatsList() {
    const chatsRef = collection(db, "chats");
    
    chatsUnsubscribe = onSnapshot(chatsRef, (snapshot) => {
        const listDiv = document.getElementById('chats-list');
        if (!listDiv) return;
        listDiv.innerHTML = '';

        // FIX: Pega todos os chats que NÃO estão com status 'closed' (fechados/encerrados)
        const activeChats = snapshot.docs.filter(docSnap => {
            const status = docSnap.data().status;
            return status !== 'closed';
        });

        if (activeChats.length === 0) {
            listDiv.innerHTML = `<p class="text-xs text-slate-500 text-center mt-10">Nenhum chat aberto no momento.</p>`;
            return;
        }

        activeChats.forEach((docSnap) => {
            const chat = docSnap.data();
            const chatId = docSnap.id;
            const isSelected = currentActiveChatId === chatId;

            listDiv.innerHTML += `
                <div onclick="window.selectChat('${chatId}')" class="p-3 rounded-lg cursor-pointer border transition text-xs ${isSelected ? 'bg-blue-600/20 border-blue-500 text-slate-100' : 'bg-slate-900 border-slate-700 hover:border-slate-600 text-slate-300'}">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold text-blue-400">Cliente ID: ${chatId.substring(0, 6)}...</span>
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    </div>
                    <p class="text-[10px] text-slate-400">Clique para abrir atendimento</p>
                </div>
            `;
        });
    }, (error) => {
        console.error("Erro ao buscar lista de chats:", error);
    });
}

window.selectChat = async function(chatId) {
    currentActiveChatId = chatId;
    
    const chatSnap = await getDoc(doc(db, "chats", chatId));
    const pinnedInfo = document.getElementById('pinned-purchase-info');
    const pinnedItems = document.getElementById('pinned-purchase-items');
    const pinnedProofInfo = document.getElementById('pinned-proof-info');
    const pinnedProofLink = document.getElementById('pinned-proof-link');

    // CORRIGIDO: o campo salvo pelo cliente (em app.js, dentro de confirmPayment)
    // se chama "items", e não "itemsPurchased". Também formata preço e quantidade.
    if (chatSnap.exists() && Array.isArray(chatSnap.data().items) && chatSnap.data().items.length > 0) {
        const items = chatSnap.data().items;
        pinnedItems.innerHTML = items.map(i => {
            const qty = i.quantity || 1;
            const total = (i.price * qty).toFixed(2).replace('.', ',');
            return `• <b>${i.name}</b> (x${qty}) - R$ ${total}`;
        }).join('<br>');
        pinnedInfo.classList.remove('hidden');
    } else {
        pinnedItems.innerHTML = 'Nenhum item registrado para este chat.';
        pinnedInfo.classList.remove('hidden');
    }

    // NOVO: mostra o link do comprovante, se existir
    const proofLink = chatSnap.exists() ? chatSnap.data().proofLink : null;
    if (proofLink) {
        pinnedProofLink.href = proofLink;
        pinnedProofLink.textContent = proofLink;
        pinnedProofInfo.classList.remove('hidden');
    } else {
        pinnedProofInfo.classList.add('hidden');
    }

    document.getElementById('team-chat-controls').classList.remove('hidden');
    document.getElementById('chat-actions').classList.remove('hidden');
    document.getElementById('active-chat-header').innerHTML = `<span class="text-xs text-blue-400 font-bold">Atendendo: ${chatId.substring(0, 8)}...</span>`;

    loadTeamMessages(chatId);
    loadActiveChatsList();
};

function loadTeamMessages(chatId) {
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    if (teamUnsubscribeMessages) teamUnsubscribeMessages();

    teamUnsubscribeMessages = onSnapshot(q, (snapshot) => {
        const messagesDiv = document.getElementById('team-chat-messages');
        if (!messagesDiv) return;
        messagesDiv.innerHTML = '';

        if (snapshot.empty) {
            messagesDiv.innerHTML = `<p class="text-slate-500 text-center my-auto text-xs">Nenhuma mensagem nesta conversa ainda.</p>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const isTeam = msg.sender === 'team';
            messagesDiv.innerHTML += `
                <div class="p-2.5 rounded-lg max-w-[85%] text-xs ${isTeam ? 'bg-blue-600 self-end text-white' : 'bg-slate-900 border border-slate-700 self-start text-slate-200'}">
                    <b>${isTeam ? 'Equipe' : 'Cliente'}:</b> ${msg.text}
                </div>
            `;
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

window.sendTeamMessage = async function() {
    const input = document.getElementById('team-message-input');
    if (!input || !input.value.trim() || !currentActiveChatId) return;

    const text = input.value;
    input.value = '';

    try {
        await addDoc(collection(db, "chats", currentActiveChatId, "messages"), {
            sender: 'team',
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Erro ao enviar resposta da equipe:", error);
        alert("Erro ao enviar mensagem.");
    }
}

window.handleTeamKeypress = function(e) {
    if (e.key === 'Enter') {
        window.sendTeamMessage();
    }
}

window.closeActiveChat = async function() {
    if (!currentActiveChatId) return;

    if (confirm('Deseja realmente concluir e encerrar este chat?')) {
        try {
            const chatRef = doc(db, "chats", currentActiveChatId);
            await updateDoc(chatRef, { status: 'closed' });

            if (teamUnsubscribeMessages) teamUnsubscribeMessages();
            currentActiveChatId = null;

            const messagesDiv = document.getElementById('team-chat-messages');
            if (messagesDiv) {
                messagesDiv.innerHTML = `<p class="text-slate-500 text-center my-auto text-xs">Nenhuma conversa selecionada.</p>`;
            }
            
            document.getElementById('team-chat-controls')?.classList.add('hidden');
            document.getElementById('pinned-purchase-info')?.classList.add('hidden');
            
            const header = document.getElementById('active-chat-header');
            if (header) {
                header.innerHTML = `<span class="text-xs text-slate-400 font-medium">Selecione um chat ao lado para conversar</span>`;
            }
            
            alert('Chat concluído e encerrado com sucesso!');
        } catch (error) {
            console.error("Erro ao fechar chat:", error);
        }
    }
}

// ==========================================
// CHAT INTERNO DA EQUIPE
// ==========================================
function loadTeamChat() {
    const teamChatContainer = document.getElementById('team-chat-container');
    if (!teamChatContainer) return;

    const teamMessagesRef = collection(db, "team_chat");
    const q = query(teamMessagesRef, orderBy("timestamp", "asc"));

    onSnapshot(q, (snapshot) => {
        teamChatContainer.innerHTML = '';

        if (snapshot.empty) {
            teamChatContainer.innerHTML = `<p class="text-slate-500 text-center text-xs my-auto">Nenhuma mensagem no chat da equipe ainda.</p>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            teamChatContainer.innerHTML += `
                <div class="bg-slate-800 border border-slate-700 p-2.5 rounded-lg text-xs flex flex-col">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold text-blue-400">${msg.senderName}</span>
                        <span class="text-[10px] text-slate-500">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Agora'}</span>
                    </div>
                    <p class="text-slate-200">${msg.text}</p>
                </div>
            `;
        });
        teamChatContainer.scrollTop = teamChatContainer.scrollHeight;
    });
}

window.sendTeamInternalMessage = async function() {
    console.log("1. Botão de enviar ou Enter acionado!");

    const input = document.getElementById('team-internal-message-input');
    if (!input) {
        console.error("❌ ERRO: O elemento com id 'team-internal-message-input' NÃO foi encontrado no HTML!");
        alert("Erro: Input de chat interno não encontrado no HTML.");
        return;
    }

    if (!input.value.trim()) return;

    const user = auth.currentUser;
    const text = input.value;
    input.value = '';

    try {
        await addDoc(collection(db, "team_chat"), {
            senderName: user ? (user.displayName || user.email || "Membro da Equipe") : "Equipe Thulerx",
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("❌ ERRO CRÍTICO DO FIREBASE AO ENVIAR:", error);
        alert("Erro ao enviar: " + error.message);
    }
}

window.handleTeamInternalKeypress = function(e) {
    if (e.key === 'Enter') {
        window.sendTeamInternalMessage();
    }
}