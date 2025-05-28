import TelegramBot from 'node-telegram-bot-api';
import { stream, video_info } from 'play-dl';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = '7981012812:AAGKOXeTL0QBFucfjXsFc81Ma7-e3govb8g';

// Configura ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Traccia le conversioni in corso
const activeConversions = new Map();

const bot = new TelegramBot(token, { polling: true });

console.log('Bot avviato con successo...');

function getProgressBar(percent) {
    const totalBlocks = 10;
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return '🟩'.repeat(filledBlocks) + '⬜'.repeat(emptyBlocks) + ` ${percent.toFixed(0)}%`;
}

// Funzione per verificare se l'URL è di YouTube
function isYoutubeUrl(url) {
    try {
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        return youtubeRegex.test(url);
    } catch (error) {
        console.error('Errore nella verifica dell\'URL:', error);
        return false;
    }
}

bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const messageText = msg.text;
        console.log(`Ricevuto messaggio da ${msg.from.first_name}: ${messageText}`);

        // Verifica se c'è già una conversione in corso per questo utente
        if (activeConversions.has(chatId)) {
            await bot.sendMessage(chatId, '⏳ Hai già una conversione in corso. Attendi il completamento prima di inviare un nuovo link.');
            return;
        }

        // Se è il primo messaggio, invia il messaggio di benvenuto
        if (!messageText.includes('http')) {
            await bot.sendMessage(chatId, `Ciao! ${msg.from.first_name} sono Yoump, mandami un link youtube e ti convertirò in mp3 il video`);
            return;
        }

        // Verifica se il link è di YouTube
        if (isYoutubeUrl(messageText)) {
            console.log('Link YouTube valido, procedo con la conversione...');
            
            // Invia un messaggio di "in elaborazione"
            const processingMsg = await bot.sendMessage(chatId, '🎵 Elaborazione del video in corso...');
            
            // Marca questa conversione come attiva
            activeConversions.set(chatId, true);

            try {
                // Ottieni informazioni sul video
                console.log('Recupero informazioni sul video...');
                const info = await video_info(messageText);
                const videoTitle = info.video_details.title;
                console.log('Titolo del video:', videoTitle);

                // Prepara il nome del file
                const sanitizedTitle = videoTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const outputPath = path.join(__dirname, `${sanitizedTitle}.mp3`);
                console.log('Percorso di output:', outputPath);

                // Download e conversione
                console.log('Inizio download e conversione...');
                const videoStream = await stream(messageText);
                
                let lastPercent = 0;
                ffmpeg(videoStream.stream)
                    .audioBitrate(128)
                    .save(outputPath)
                    .on('progress', async (progress) => {
                        const percent = progress.percent ? Math.min(progress.percent, 100) : 0;
                        if (percent - lastPercent >= 5 || percent === 100) { // aggiorna solo ogni 5%
                            lastPercent = percent;
                            const bar = getProgressBar(percent);
                            try {
                                await bot.editMessageText(`🎵 Conversione in corso...\n${bar}`, {
                                    chat_id: chatId,
                                    message_id: processingMsg.message_id
                                });
                            } catch (e) {
                                // Ignora errori di rate limit o messaggio già aggiornato
                            }
                        }
                        console.log('Progresso:', percent, '%');
                    })
                    .on('end', async () => {
                        console.log('Conversione completata, invio file...');
                        try {
                            // Invia il file MP3
                            await bot.sendAudio(chatId, outputPath, {
                                title: videoTitle,
                                performer: 'YouTube'
                            });
                            
                            // Aggiorna il messaggio di stato
                            await bot.editMessageText('✅ Conversione completata!', {
                                chat_id: chatId,
                                message_id: processingMsg.message_id
                            });

                            // Elimina il file dopo l'invio
                            fs.unlink(outputPath, (err) => {
                                if (err) console.error('Errore nella cancellazione del file:', err);
                                else console.log('File temporaneo eliminato');
                            });
                        } catch (error) {
                            console.error('Errore nell\'invio del file:', error);
                            await bot.editMessageText('❌ Errore nell\'invio del file', {
                                chat_id: chatId,
                                message_id: processingMsg.message_id
                            });
                        }
                    })
                    .on('error', async (err) => {
                        console.error('Errore nella conversione:', err);
                        await bot.editMessageText('❌ Errore nella conversione del video', {
                            chat_id: chatId,
                            message_id: processingMsg.message_id
                        });
                    });

            } catch (error) {
                console.error('Errore nel recupero delle informazioni del video:', error);
                await bot.editMessageText('❌ Errore nel recupero delle informazioni del video', {
                    chat_id: chatId,
                    message_id: processingMsg.message_id
                });
            }
        } else {
            console.log('Link non valido');
            await bot.sendMessage(chatId, '❌ Link non compatibile. Per favore, invia solo link di YouTube.');
        }
    } catch (error) {
        console.error('Errore generale:', error);
        if (msg && msg.chat) {
            await bot.sendMessage(msg.chat.id, '❌ Si è verificato un errore durante l\'elaborazione del video.');
        }
    } finally {
        // Rimuovi la conversione dalla lista delle attive
        activeConversions.delete(chatId);
    }
});