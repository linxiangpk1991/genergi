import Crypto from "node:crypto"
import { writeFileSync } from "node:fs"

import axios from "axios"
import { parseBuffer } from "music-metadata"
import { stringifySync as subtitleStringifySync, type NodeList as SubtitleNodeList } from "subtitle"
import WebSocket from "ws"

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
const VOICE_LIST_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`

const CHROMIUM_FULL_VERSION = "143.0.3650.75"
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".", 1)[0]
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`
const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
const AUDIO_EXTENSION = ".mp3"

type AudioMetadata = {
  format: string
  bitrate: string
  sampleRate: number
  channels: number
}

const AUDIO_METADATA: AudioMetadata = {
  format: "mp3",
  bitrate: "48k",
  sampleRate: 24000,
  channels: 1,
}

export type SynthesisOptions = {
  pitch?: number
  rate?: number
  volume?: number
}

export type WordBoundary = {
  Offset: number
  Duration: number
  text: {
    Text: string
    Length: number
    BoundaryType: string
  }
}

const BASE_HEADERS = {
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
}

const WSS_HEADERS = {
  ...BASE_HEADERS,
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "Sec-WebSocket-Version": "13",
}

const VOICE_HEADERS = {
  ...BASE_HEADERS,
  Authority: "speech.platform.bing.com",
  "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  "Sec-CH-UA-Mobile": "?0",
  Accept: "*/*",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
}

const WIN_EPOCH = 11644473600
const S_TO_NS = 1e9

class DRM {
  private static clockSkewSeconds = 0

  static getUnixTimestamp() {
    return Date.now() / 1000 + DRM.clockSkewSeconds
  }

  static parseRfc2616Date(date: string) {
    const parsed = new Date(date)
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime() / 1000
  }

  static handleClientResponseError(error: any) {
    const headers = error.headers
    if (!headers) {
      return
    }

    const serverDate: string | undefined = headers.get ? headers.get("Date") : headers.date
    if (!serverDate) {
      return
    }

    const serverTimestamp = DRM.parseRfc2616Date(serverDate)
    if (serverTimestamp === null) {
      return
    }

    DRM.clockSkewSeconds += serverTimestamp - DRM.getUnixTimestamp()
  }

  static generateSecMsGec() {
    let ticks = DRM.getUnixTimestamp()
    ticks += WIN_EPOCH
    ticks -= ticks % 300
    ticks *= S_TO_NS / 100

    const raw = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`
    const hash = Crypto.createHash("sha256")
    hash.update(raw, "ascii")
    return hash.digest("hex").toUpperCase()
  }
}

function removeIncompatibleCharacters(text: string) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
}

function splitTextByByteLength(text: string, byteLength: number) {
  const chunks: string[] = []
  let currentText = Buffer.from(text, "utf8")
  while (currentText.length > byteLength) {
    let splitAt = currentText.lastIndexOf(Buffer.from("\n"), byteLength)
    if (splitAt < 0) {
      splitAt = currentText.lastIndexOf(Buffer.from(" "), byteLength)
    }
    if (splitAt < 0) {
      splitAt = byteLength
    }
    const chunk = currentText.subarray(0, splitAt).toString("utf8").trim()
    if (chunk) {
      chunks.push(chunk)
    }
    currentText = currentText.subarray(splitAt)
  }
  const remain = currentText.toString("utf8").trim()
  if (remain) {
    chunks.push(remain)
  }
  return chunks
}

class EdgeTTSResult {
  constructor(
    private readonly wordList: WordBoundary[],
    private readonly audioBuffer: Buffer,
  ) {}

  getWordBoundaries() {
    return this.wordList
  }

  getBuffer() {
    return this.audioBuffer
  }

  async toFile(outputPath: string) {
    writeFileSync(outputPath.endsWith(AUDIO_EXTENSION) ? outputPath : `${outputPath}${AUDIO_EXTENSION}`, this.audioBuffer)
  }

  getCaptionSrtString() {
    const cues: SubtitleNodeList = []
    let sentence: WordBoundary[] = []

    const isCompactScript = (char: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)

    const flush = () => {
      if (!sentence.length) {
        return
      }
      const first = sentence[0]
      const last = sentence[sentence.length - 1]
      const joined = sentence
        .map((item) => item.text.Text)
        .reduce((acc, text, index) => {
          if (index === 0) {
            return text
          }
          const prevChar = acc.at(-1) ?? ""
          const currChar = text[0] ?? ""
          return acc + (isCompactScript(prevChar) && isCompactScript(currChar) ? "" : " ") + text
        }, "")

      cues.push({
        type: "cue",
        data: {
          start: first.Offset / 10000,
          end: (last.Offset + last.Duration) / 10000,
          text: joined,
        },
      })
      sentence = []
    }

    this.wordList.forEach((word, index) => {
      const previous = this.wordList[index - 1]
      const gap = previous ? word.Offset - (previous.Offset + previous.Duration) : 0
      if (index !== 0 && gap > 100 * 10 ** 4) {
        flush()
      }
      sentence.push(word)
    })

    flush()
    return subtitleStringifySync(cues, { format: "SRT" })
  }

  async getDurationSeconds() {
    const metadata = await parseBuffer(this.audioBuffer, { mimeType: "audio/mpeg" })
    return metadata.format?.duration ?? 0
  }
}

export class EdgeTTS {
  async getVoices() {
    const response = await axios.get(VOICE_LIST_URL, { headers: VOICE_HEADERS })
    return response.data
  }

  async synthesize(text: string, voice = "en-US-AvaMultilingualNeural", options: SynthesisOptions = {}) {
    const cleaned = removeIncompatibleCharacters(text)
    const chunks = splitTextByByteLength(cleaned, 4096)
    const audioData: Buffer[] = []
    const words: WordBoundary[] = []
    let offset = 0

    for (const chunk of chunks) {
      const result = await this.synthesizeSingle(chunk, voice, options)
      audioData.push(result.getBuffer())
      const duration100ns = Math.round((await result.getDurationSeconds()) * 10 ** 7)
      for (const word of result.getWordBoundaries()) {
        words.push({
          ...word,
          Offset: word.Offset + offset,
        })
      }
      const lastWord = result.getWordBoundaries().at(-1)
      offset += Math.max(duration100ns, lastWord ? lastWord.Offset + lastWord.Duration : 0)
    }

    return new EdgeTTSResult(words, Buffer.concat(audioData))
  }

  private async synthesizeSingle(text: string, voice: string, options: SynthesisOptions) {
    return new Promise<EdgeTTSResult>((resolve, reject) => {
      const requestId = Crypto.randomUUID()
      const audioStream: Buffer[] = []
      const wordList: WordBoundary[] = []
      const ws = new WebSocket(
        `${WSS_URL}&Sec-MS-GEC=${DRM.generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${requestId}`,
        { headers: WSS_HEADERS },
      )

      ws.on("open", () => {
        ws.send(this.buildTTSConfigMessage())
        ws.send(this.buildSpeechMessage(requestId, this.getSSML(text, voice, options)))
      })

      ws.on("message", (data: Buffer) => {
        this.processCaptionData(data, wordList)
        this.processAudioData(data, audioStream, ws)
      })

      ws.on("close", () => {
        resolve(new EdgeTTSResult(wordList, Buffer.concat(audioStream)))
      })

      ws.on("error", reject)
    })
  }

  private getSSML(text: string, voice: string, options: SynthesisOptions) {
    const pitch = options.pitch ?? 0
    const rate = options.rate ?? 0
    const volume = options.volume ?? 0
    return `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}Hz' rate='${rate}%' volume='${volume}%'>${text}</prosody></voice></speak>`
  }

  private buildTTSConfigMessage() {
    const timestamp = `${new Date().toISOString()}Z`
    return (
      `X-Timestamp:${timestamp}\r\n` +
      "Content-Type:application/json; charset=utf-8\r\n" +
      "Path:speech.config\r\n\r\n" +
      JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: false,
                wordBoundaryEnabled: true,
              },
              outputFormat: AUDIO_FORMAT,
            },
          },
        },
      })
    )
  }

  private buildSpeechMessage(requestId: string, ssmlText: string) {
    const timestamp = `${new Date().toISOString()}Z`
    return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssmlText}`
  }

  private processCaptionData(data: Buffer, wordBoundaryList: WordBoundary[]) {
    const needle = Buffer.from("Path:audio.metadata\r\n")
    const startIndex = data.indexOf(needle)
    if (startIndex === -1) {
      return
    }
    const metaData = JSON.parse(data.subarray(startIndex + needle.length).toString("utf8"))?.Metadata
    if (metaData?.[0]?.Type === "WordBoundary") {
      wordBoundaryList.push(metaData[0].Data)
    }
  }

  private processAudioData(data: Buffer, audioStream: Buffer[], ws: WebSocket) {
    const needle = Buffer.from("Path:audio\r\n")
    const startIndex = data.indexOf(needle)
    if (startIndex !== -1) {
      const audioData = data.subarray(startIndex + needle.length)
      if (audioData.length > 0) {
        audioStream.push(audioData)
      }
    }
    if (data.includes("Path:turn.end")) {
      ws.close()
    }
  }
}
