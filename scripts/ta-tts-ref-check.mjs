#!/usr/bin/env node
/**
 * TA 参考音频体检（GPT-SoVITS 的 ref_audio_path 该不该用这一条）
 *
 * 为什么会话开头就要跑这个：GPT-SoVITS 是 zero-shot 克隆，参考音频决定「她」的声音。
 * 一条 1.2 秒 / 带背景音乐 / 削波 / 静音的样本，合成出来不是「换个音色」，而是
 * 口音、语速、底噪全部跟着跑偏 —— 而链上是会自动降级的，你只会听到 MeloTTS 或
 * 一段听感奇怪的自建音频，很难一眼看出是样本的问题。
 *
 * 用法：
 *   node scripts/ta-tts-ref-check.mjs "D:\AI\refs\xiaoman.wav"
 *   node scripts/ta-tts-ref-check.mjs "D:\AI\refs\xiaoman.mp3" --json
 *
 * 只读：不修改、不转换原文件；需要转码时把命令打给你，你自己决定跑不跑。
 * 依赖本机 GPT-SoVITS 整合包自带的 ffmpeg（不要求系统 PATH 里有 ffmpeg）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG = process.env.TA_GPTSOVITS_DIR || 'D:\\AI\\GPT-SoVITS-v2pro-20250604-nvidia50';
const FFMPEG = path.join(PKG, 'runtime', 'ffmpeg.exe');

const MIN_SEC = 3;
const MAX_SEC = 10;
// 超过这个时长不是不能用，只是 GPT-SoVITS 官方建议 3~10 s：再长推理更慢、收益很小。
const HARD_MAX_SEC = 20;
const PEAK_DB = -0.5;      // 高于它就当削波
const QUIET_DB = -35;      // 平均音量低于它就是「太小声 / 几乎静音」

function die(msg) {
    console.error('ERROR ' + msg);
    process.exit(2);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) die('用法: node scripts/ta-tts-ref-check.mjs <音频文件> [--json]');
if (!fs.existsSync(file)) die('文件不存在: ' + file);
if (!fs.existsSync(FFMPEG)) die('找不到整合包自带的 ffmpeg: ' + FFMPEG + '（可用 TA_GPTSOVITS_DIR 指定整合包目录）');

/** ffmpeg -i 的 stderr 是唯一不依赖 ffprobe 的元信息来源（整合包不一定带 ffprobe） */
function probe(input) {
    // ffmpeg 把「输入文件的元信息 + volumedetect 结果」一律打在 stderr 上，
    // 而且**成功退出**时也打 —— 所以不能只在失败分支里读（第一版就踩了这个坑）。
    const r = spawnSync(FFMPEG, ['-hide_banner', '-i', input, '-af', 'volumedetect', '-f', 'null', '-'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
    });
    const stderr = String(r.stderr || '');
    if (!stderr && r.error) throw new Error('ffmpeg 起不来: ' + r.error.message);
    if (r.status !== 0 && !/Duration:/.test(stderr)) throw new Error('ffmpeg 读不了这个文件: ' + file + '\n' + stderr.slice(-400));
    const dur = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    const stream = /Stream #\d+:\d+.*?: Audio: ([a-z0-9_]+)[^\n]*?(\d+) Hz, ([a-z0-9.()]+)/i.exec(stderr);
    const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
    const max = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
    return {
        seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
        codec: stream ? stream[1] : '',
        rate: stream ? Number(stream[2]) : 0,
        channels: stream ? stream[3] : '',
        meanDb: mean ? Number(mean[1]) : null,
        maxDb: max ? Number(max[1]) : null
    };
}

function fmtDb(v) {
    return v === null ? '?' : String(v) + ' dB';
}

const info = probe(file);
const sizeKb = Math.round(fs.statSync(file).size / 1024);
const mono = /^(mono|1)/i.test(info.channels);
const problems = [];
const notes = [];

if (!info.seconds) problems.push('读不出时长（可能不是音频文件 / 文件损坏）');
else if (info.seconds < MIN_SEC) problems.push('太短：' + info.seconds.toFixed(2) + ' s（GPT-SoVITS 至少 3 s，建议 5~10 s）');
else if (info.seconds > HARD_MAX_SEC) problems.push('太长：' + info.seconds.toFixed(2) + ' s（建议 ≤10 s，别超过 20 s）');
else if (info.seconds > MAX_SEC) notes.push('偏长（' + info.seconds.toFixed(2) + ' s）：能跑，但官方建议 3~10 s');

if (info.maxDb !== null && info.maxDb > PEAK_DB) problems.push('削波：峰值 ' + fmtDb(info.maxDb) + '（超过 -0.5 dB，录音时音量调小一档重录更好）');
if (info.meanDb !== null && info.meanDb < QUIET_DB) problems.push('太小声：平均 ' + fmtDb(info.meanDb) + '（低于 -35 dB，模型会把它当噪声）');
if (!mono) notes.push('不是单声道（' + info.channels + '）：能用，但转 mono 后更稳');
if (info.rate && ![16000, 32000, 44100, 48000].includes(info.rate)) notes.push('采样率 ' + info.rate + ' Hz 不常见，建议转 32 kHz');

const ok = problems.length === 0;
const out = {
    ok: ok,
    file: path.resolve(file),
    sizeKb: sizeKb,
    seconds: Number(info.seconds.toFixed(2)),
    codec: info.codec,
    sampleRate: info.rate,
    channels: info.channels,
    meanDb: info.meanDb,
    peakDb: info.maxDb,
    problems: problems,
    notes: notes
};

if (asJson) {
    console.log(JSON.stringify(out, null, 2));
} else {
    console.log('参考音频体检: ' + out.file);
    console.log('  时长 ' + out.seconds + ' s | ' + (out.codec || '?') + ' ' + (out.sampleRate || '?') + ' Hz ' + (out.channels || '?') +
        ' | ' + sizeKb + ' KB | 平均 ' + fmtDb(out.meanDb) + ' / 峰值 ' + fmtDb(out.peakDb));
    for (const p of problems) console.log('  FAIL ' + p);
    for (const n of notes) console.log('  NOTE ' + n);
    if (ok) console.log('  PASS 可以当 TA_TTS_LOCAL_REF 用（3~10 s、不削波、人声清楚）');
    if (!mono || (info.rate && info.rate !== 32000) || problems.length) {
        const stem = path.parse(file).name;
        const fixed = path.join(path.dirname(file), stem + '_mono32k.wav');
        console.log('\n  想规整成「单声道 32 kHz」再喂给它（不改原文件）:');
        console.log('  "' + FFMPEG + '" -y -i "' + file + '" -ac 1 -ar 32000 -af "loudnorm=I=-18:TP=-2" "' + fixed + '"');
    }
}

process.exit(ok ? 0 : 1);
