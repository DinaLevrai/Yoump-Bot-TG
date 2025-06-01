import TelegramBot from 'node-telegram-bot-api';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = '7981012812:AAGKOXeTL0QBFucfjXsFc81Ma7-e3govb8g'; // Il tuo token
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const activeConversions = new Map();

const bot = new TelegramBot(token, { polling: true });

console.log('Bot avviato con successo...');

function getProgressBar(percent) {
    const totalBlocks = 14;
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return '🟩'.repeat(filledBlocks) + '⬜'.repeat(emptyBlocks) + ` ${percent.toFixed(0)}%`;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '??:??';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function isYoutubeUrl(url) {
    try {
        return ytdl.validateURL(url);
    } catch (error) {
        return false;
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    console.log(`[${chatId}] Ricevuto messaggio da ${msg.from.first_name}: ${messageText}`);

    let processingMsg = null;
    let statusMsg = null;
    let outputPath = null;

    try {
        if (!messageText || !messageText.includes('http')) {
            await bot.sendMessage(chatId, `🎵 *Ciao ${msg.from.first_name}!* 🎵\n\nSono *Yoump*, il tuo DJ personale per convertire i video di YouTube in MP3! 🎧\n\n*Come posso aiutarti oggi?* 🤔\n\n📝 *È semplicissimo:*\n1️⃣ Invia un link di YouTube\n2️⃣ Mi prendo cura della conversione\n3️⃣ Scarica la tua canzone preferita\n\n💡 *Suggerimento:* Assicurati di inviare solo link di YouTube validi. Sono un po' pignolo con i link! 😉\n\n*Pronto a creare la tua playlist?* 🎶`, { parse_mode: 'Markdown' });
            return;
        }

        if (activeConversions.has(chatId)) {
            await bot.sendMessage(chatId, '⏳ *Ops!* Hai già una conversione in corso. 🎵\n\nDai, finisci di ascoltare questa prima di chiedermene un\'altra! 😊', { parse_mode: 'Markdown' });
            return;
        }
        
        if (isYoutubeUrl(messageText)) {
            console.log(`[${chatId}] Link YouTube valido, procedo con la conversione...`);
            
            processingMsg = await bot.sendMessage(chatId, '🎵 *Sto dando un\'occhiata al tuo video...*\n\nMi serve un attimo per preparare tutto! ⏳', { parse_mode: 'Markdown' });
            activeConversions.set(chatId, { messageId: processingMsg.message_id, startTime: Date.now(), videoDuration: 0 });

            try {
                console.log(`[${chatId}] Recupero informazioni sul video...`);
                const info = await ytdl.getInfo(messageText);
                const videoTitle = info.videoDetails.title;
                const videoDurationSeconds = parseInt(info.videoDetails.lengthSeconds, 10);
                
                if (activeConversions.has(chatId)) {
                    activeConversions.get(chatId).videoDuration = videoDurationSeconds;
                }

                console.log(`[${chatId}] Titolo: "${videoTitle}" (Durata: ${formatTime(videoDurationSeconds)})`);

                const sanitizedTitle = videoTitle.replace(/[^a-z0-9\s]/gi, '_').toLowerCase();
                outputPath = path.join(__dirname, `${sanitizedTitle}.mp3`);
                console.log(`[${chatId}] Percorso di output: ${outputPath}`);

                await bot.deleteMessage(chatId, processingMsg.message_id).catch(e => console.error(`[${chatId}] Errore nel cancellare messaggio di elaborazione:`, e.message));
                
                statusMsg = await bot.sendMessage(chatId, `🎵 *Sto scaricando "${videoTitle}"...*\n${getProgressBar(0)}\n⏱️ *Tempo stimato:* ${formatTime(videoDurationSeconds)}`, { parse_mode: 'Markdown' });
                
                if (activeConversions.has(chatId)) {
                    activeConversions.get(chatId).messageId = statusMsg.message_id;
                }

                let lastDownloadPercent = 0;
                let lastFfmpegPercent = 0;
                const downloadStartTime = Date.now();
                let ffmpegStartTime = 0;

                const videoStream = ytdl(messageText, {
                    quality: 'highestaudio',
                    filter: 'audioonly'
                });

                let totalBytes = 0;
                let downloadedBytes = 0;
                videoStream.on('info', (info, format) => {
                    totalBytes = parseInt(format.contentLength, 10);
                    console.log(`[${chatId}] Dimensione audio stimata: ${totalBytes} bytes`);
                });

                videoStream.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const downloadPercent = (downloadedBytes / totalBytes) * 100;
                        if (downloadPercent - lastDownloadPercent >= 2 || downloadPercent >= 99.9) {
                            lastDownloadPercent = downloadPercent;
                            const bar = getProgressBar(downloadPercent);
                            const elapsedTime = (Date.now() - downloadStartTime) / 1000;
                            let remainingTimeStr = '??:??';
                            if (downloadPercent > 0) {
                                const estimatedTotalTime = elapsedTime / (downloadPercent / 100);
                                remainingTimeStr = formatTime(Math.max(0, estimatedTotalTime - elapsedTime));
                            } else if (videoDurationSeconds > 0) {
                                remainingTimeStr = formatTime(videoDurationSeconds);
                            }
                            
                            const message = `🎵 *Sto scaricando "${videoTitle}"...*\n${bar}\n⏱️ *Tempo rimanente:* ${remainingTimeStr}`;
                            
                            if (statusMsg && statusMsg.message_id) {
                                bot.editMessageText(message, {
                                    chat_id: chatId,
                                    message_id: statusMsg.message_id,
                                    parse_mode: 'Markdown'
                                }).catch(e => {
                                    if (!e.message.includes('message to edit not found')) {
                                        console.error(`[${chatId}] Errore nell'aggiornamento del messaggio di download:`, e.message);
                                    }
                                });
                            }
                        }
                    }
                });
                
                videoStream.on('end', () => {
                    console.log(`[${chatId}] Download di ytdl completato.`);
                });

                videoStream.on('error', (err) => {
                    console.error(`[${chatId}] Errore nello stream di ytdl:`, err.message);
                });


                ffmpeg(videoStream)
                    .audioBitrate(128)
                    .save(outputPath)
                    .on('start', (commandLine) => {
                        console.log(`[${chatId}] FFmpeg avviato con comando: ${commandLine}`);
                        ffmpegStartTime = Date.now();
                        if (statusMsg && statusMsg.message_id) {
                            bot.editMessageText(`🎵 *Sto convertendo "${videoTitle}" in MP3...*\n${getProgressBar(0)}\n⏱️ *Tempo stimato:* ${formatTime(activeConversions.get(chatId)?.videoDuration || 0)}`, {
                                chat_id: chatId,
                                message_id: statusMsg.message_id,
                                parse_mode: 'Markdown'
                            }).catch(e => {
                                if (!e.message.includes('message to edit not found')) {
                                    console.error(`[${chatId}] Errore nell'aggiornamento del messaggio di start FFmpeg:`, e.message);
                                }
                            });
                        }
                    })
                    .on('progress', async (progress) => {
                        const conversionData = activeConversions.get(chatId);
                        const videoDuration = conversionData?.videoDuration || 0; // Durata totale del video da ytdl.getInfo
                        
                        // Parsifica timemark (es. "00:00:15.12") in secondi totali
                        const timemarkParts = progress.timemark.split(':');
                        let secondsProcessed = 0;
                        if (timemarkParts.length === 3) {
                            secondsProcessed = parseInt(timemarkParts[0]) * 3600 + // ore
                                               parseInt(timemarkParts[1]) * 60 +   // minuti
                                               parseFloat(timemarkParts[2]);      // secondi (con millisecondi)
                        } else {
                            console.warn(`[${chatId}] Formato timemark inatteso: ${progress.timemark}`);
                            // Fallback se il formato non è quello atteso
                            secondsProcessed = progress.timemark ? parseFloat(progress.timemark) : 0;
                        }

                        let percent = 0;
                        if (videoDuration > 0) {
                            // Calcola la percentuale in base al tempo processato rispetto alla durata totale
                            percent = (secondsProcessed / videoDuration) * 100;
                            percent = Math.min(percent, 100); // Assicurati che non superi il 100%
                        } else if (progress.percent !== undefined) {
                            // Fallback meno affidabile se videoDuration non è disponibile
                            percent = Math.min(progress.percent, 100);
                        }
                        
                        // Aggiorna il messaggio solo se la percentuale è cambiata significativamente o è quasi completa
                        if (percent - lastFfmpegPercent >= 2 || percent >= 99.9) {
                            lastFfmpegPercent = percent;
                            const bar = getProgressBar(percent);
                            
                            let remainingTimeStr = '??:??';
                            // STIMA PRIMARIA: Basata su durata totale - tempo processato
                            if (videoDuration > 0 && secondsProcessed > 0) {
                                const remainingSecs = Math.max(0, videoDuration - secondsProcessed);
                                remainingTimeStr = formatTime(remainingSecs);
                            } else if (videoDuration > 0) {
                                // Stima iniziale (se secondsProcessed è ancora 0), mostra la durata totale
                                remainingTimeStr = formatTime(videoDuration);
                            } else if (ffmpegStartTime > 0 && percent > 0) {
                                // ULTIMA RISORSA: Se videoDuration non è disponibile, stima basata sulla velocità attuale
                                const elapsedTime = (Date.now() - ffmpegStartTime) / 1000;
                                const estimatedTotalTime = elapsedTime / (percent / 100);
                                const remainingSecs = Math.max(0, estimatedTotalTime - elapsedTime);
                                remainingTimeStr = formatTime(remainingSecs);
                            }

                            const message = `🎵 *Sto convertendo "${videoTitle}" in MP3...*\n${bar}\n⏱️ *Tempo rimanente:* ${remainingTimeStr}`;
                            
                            try {
                                if (statusMsg && statusMsg.message_id) {
                                    await bot.editMessageText(message, {
                                        chat_id: chatId,
                                        message_id: statusMsg.message_id,
                                        parse_mode: 'Markdown'
                                    });
                                }
                            } catch (e) {
                                // Se il messaggio non viene trovato (es. utente lo ha cancellato), non è un errore critico
                                if (!e.message.includes('message to edit not found')) {
                                    console.error(`[${chatId}] Errore nell'aggiornamento del messaggio di progresso FFmpeg:`, e.message);
                                }
                            }
                        }
                    })
                    .on('end', async () => {
                        try {
                            console.log(`[${chatId}] Conversione completata. Invio file...`);
                            await bot.sendAudio(chatId, outputPath, {
                                title: videoTitle,
                                performer: 'YouTube',
                                contentType: 'audio/mpeg'
                            });
                            
                            if (statusMsg && statusMsg.message_id) {
                                await bot.editMessageText(`🎵 *Ecco fatto!* 🎉\n\nLa tua canzone "${videoTitle}" è pronta! 🎧\n\nBuon ascolto! 🎶`, {
                                    chat_id: chatId,
                                    message_id: statusMsg.message_id,
                                    parse_mode: 'Markdown'
                                });
                            }
                        } catch (error) {
                            console.error(`[${chatId}] Errore nell'invio o aggiornamento finale:`, error);
                            if (statusMsg && statusMsg.message_id) {
                                await bot.editMessageText('❌ *Ops!* Qualcosa è andato storto durante l\'invio del file.\n\nMi dispiace, riprova più tardi! 😔', {
                                    chat_id: chatId,
                                    message_id: statusMsg.message_id,
                                    parse_mode: 'Markdown'
                                });
                            }
                        }
                    })
                    .on('error', async (err, stdout, stderr) => {
                        console.error(`[${chatId}] Errore FFmpeg:`, err.message);
                        if (stdout) console.error(`[${chatId}] FFmpeg stdout:`, stdout);
                        if (stderr) console.error(`[${chatId}] FFmpeg stderr:`, stderr);

                        if (statusMsg && statusMsg.message_id) {
                            await bot.editMessageText('❌ *Ops!* Ho avuto un problema durante la conversione.\n\nMi dispiace, riprova con un altro video! 😔', {
                                chat_id: chatId,
                                message_id: statusMsg.message_id,
                                parse_mode: 'Markdown'
                            });
                        }
                    });

            } catch (error) {
                console.error(`[${chatId}] Errore nel recupero delle informazioni del video o fase iniziale:`, error);
                if (processingMsg && processingMsg.message_id) {
                    await bot.editMessageText('❌ *Ops!* Non riesco a trovare questo video su YouTube.\n\nControlla il link e riprova! 🔍', {
                        chat_id: chatId,
                        message_id: processingMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.sendMessage(chatId, '❌ *Ops!* Non riesco a trovare questo video su YouTube.\n\nControlla il link e riprova! 🔍', { parse_mode: 'Markdown' });
                }
            }
        } else {
            console.log(`[${chatId}] Link non valido: ${messageText}`);
            await bot.sendMessage(chatId, '❌ *Ops!* Questo non sembra essere un link di YouTube valido.\n\nProva con un altro link! 🔍', { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error(`[${chatId}] Errore generale nel gestore messaggi:`, error);
        if (msg && msg.chat) {
            await bot.sendMessage(msg.chat.id, '❌ *Ops!* Qualcosa è andato storto.\n\nMi dispiace, riprova più tardi! 😔', { parse_mode: 'Markdown' });
        }
    } finally {
        if (chatId && activeConversions.has(chatId)) {
            activeConversions.delete(chatId);
            console.log(`[${chatId}] Conversione rimossa da activeConversions.`);
        }
        if (outputPath && fs.existsSync(outputPath)) {
            fs.unlink(outputPath, (err) => {
                if (err) console.error(`[${chatId}] Errore nella cancellazione del file temporaneo:`, err);
                else console.log(`[${chatId}] File temporaneo eliminato: ${outputPath}`);
            });
        }
    }
});