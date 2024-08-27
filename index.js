const { VideojsCodec, M3U8NestedCodec, M3U8Codec } = m3u8Codec.codecs;
const { CastingMixin, NamedPropertyMixin } = m3u8Codec.mixins;
const { IdentityType } = m3u8Codec.types;
const { numberCast } = m3u8Codec.casts;

const manifestUrl = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8';

const fetchManifest = async (url) => {
  const res = await fetch(url);
  const text = await res.text();
  return text;
};
const fetchMediaManifest = async (playlist) => {
  const url = new URL(getUri(playlist), manifestUrl);
  return fetchManifest(url.toString());
}
const fetchSeg = async (playlist, path) => {
  const url = new URL(path, new URL(getUri(playlist), manifestUrl));
  const seg = await fetch(url.toString());
  return seg.arrayBuffer();
}
const fetchSegment = async (playlist, segment) => {
  const map = getValue(segment, "#EXT-X-MAP");
  let mapSeg;
  if (map) {
    mapSeg = await fetchSeg(playlist, getValue(map, 'URI'));
  }
  let seg = await fetchSeg(playlist, getUri(segment));
  return [mapSeg, seg];
}

const getValue = (list, name) => list.filter(v=>v.name.toLowerCase() === name.toLowerCase())[0]?.value;
const getAttr = (playlist, name) => getValue(playlist[0].value, name);
const getUri = (playlist) => getValue(playlist, 'uri');
const getBandwidth = (playlist) => getValue(playlist[0].value, 'BANDWIDTH');
const getManifestByBandwidth = (playlists, bandwidth) => {
  return playlists.filter((playlist) => getBandwidth(playlist) < bandwidth);
};

const m3u8 = new M3U8NestedCodec();
const mainManifest = m3u8.parse(await fetchManifest(manifestUrl));

const manifests = mainManifest.playlists; //getManifestByBandwidth(mainManifest.playlists, 1*1024*1024);
let videoPlaylist = manifests[0];

const ag = getAttr(videoPlaylist, 'AUDIO');
let audioPlaylist = mainManifest.globals
  .filter(g => g.name === "#EXT-X-MEDIA")
  .filter(g => getValue(g.value, 'GROUP-ID') === "default-audio-group")
  .filter(g => getValue(g.value, "DEFAULT") === "YES")
  .pop();


let sourceBuffer;
const mediaSource = new MediaSource();

const loadPlaylist = async (playlist) => {
  const mediaManifest = m3u8.parse(await fetchMediaManifest(playlist));
  let segmentIndex = 0;

  const startPlayback = async () => {
    if (segmentIndex >= mediaManifest.segments.length) {
      mediaSource.endOfStream();
      return;
    }

    const [map, segment] = await fetchSegment(playlist, mediaManifest.segments[segmentIndex]);
    if (map) {
      sourceBuffer.appendBuffer(map);
      sourceBuffer.addEventListener('updateend', () => {
        sourceBuffer.appendBuffer(segment);
        sourceBuffer.addEventListener('updateend', () => {
          segmentIndex++;
          startPlayback();
        }, {once: true});
      }, {once: true});
      return;
    }

    // TODO need to handle audio manifest as well as video
    sourceBuffer.appendBuffer(segment);
    segmentIndex++;
    sourceBuffer.addEventListener('updateend', () => {
      startPlayback();
    }, {once:true});
  };

  return startPlayback;
}

const startPlayback = await loadPlaylist(videoPlaylist);
const startPlaybackAudio = await loadPlaylist(audioPlaylist.value);

const onsourceopen = (e) => {
  URL.revokeObjectURL(video.src);
  const mime = `video/mp4; codecs="${getAttr(videoPlaylist, 'CODECS')}"`;
  // mediaSource = e.target;
  sourceBuffer = mediaSource.addSourceBuffer(mime);
  // probably need separate source buffers for video and audio
  startPlayback();
  startPlaybackAudio();
};
mediaSource.addEventListener('sourceopen', onsourceopen, {once: true});
video.src = URL.createObjectURL(mediaSource);
