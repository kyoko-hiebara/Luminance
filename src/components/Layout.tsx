import { Panel } from "@/components/Panel";
import { Spectrum } from "@/components/visualizers/Spectrum";
import { Waveform } from "@/components/visualizers/Waveform";
import { VUMeter } from "@/components/visualizers/VUMeter";
import { Oscilloscope } from "@/components/visualizers/Oscilloscope";
import { Loudness } from "@/components/visualizers/Loudness";
import { Spectrogram } from "@/components/visualizers/Spectrogram";
import { Stereometer } from "@/components/visualizers/Stereometer";

/*
  Layout grid:
  ┌─────────────────┬──────────┬──────────┐
  │                  │ VU Meter │ Loudness │
  │    Spectrum      ├──────────┤──────────┤
  │                  │  Stereo  │  Oscillo │
  ├─────────────────┼──────────┴──────────┤
  │   Spectrogram   │       Waveform      │
  └─────────────────┴─────────────────────┘
*/

export function Layout() {
  return (
    <div
      data-render-target
      className="flex-1 gap-2 p-2 min-h-0"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr 1fr",
        gridTemplateAreas: `
          "spectrum vu       loudness"
          "spectrum stereo   oscillo"
          "spectro  waveform waveform"
        `,
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "spectrum" }}>
        <Panel title="Spectrum">
          {({ width, height }) => <Spectrum width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "vu" }}>
        <Panel title="VU Meter">
          {({ width, height }) => <VUMeter width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "loudness" }}>
        <Panel title="Loudness">
          {({ width, height }) => <Loudness width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "stereo" }}>
        <Panel title="Stereo">
          {({ width, height }) => <Stereometer width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "oscillo" }}>
        <Panel title="Oscilloscope">
          {({ width, height }) => <Oscilloscope width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "spectro" }}>
        <Panel title="Spectrogram">
          {({ width, height }) => <Spectrogram width={width} height={height} />}
        </Panel>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridArea: "waveform" }}>
        <Panel title="Waveform">
          {({ width, height }) => <Waveform width={width} height={height} />}
        </Panel>
      </div>
    </div>
  );
}
