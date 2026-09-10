import React from "react";
import releases from "@saccadejs/core/models/releases.json";

type Release = (typeof releases.releases)[number];

const SITE = "https://saccade.jspsych.org";

function urlFor(r: Release): string {
  return `${SITE}/models/${releases.id}/${r.version}/${r.file}`;
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** The release table on /models, rendered from packages/core/models/releases.json. */
export default function ModelReleases(): React.ReactElement {
  const ordered = [...releases.releases].reverse();
  return (
    <div>
      {ordered.map((r) => (
        <div key={r.version} style={{ marginBottom: "2.5rem" }}>
          <h3 id={`v${r.version}`} style={{ marginBottom: "0.25rem" }}>
            {releases.id}@{r.version}{" "}
            {r.served ? (
              <span className="badge badge--success">served</span>
            ) : (
              <span className="badge badge--secondary">retired</span>
            )}
          </h3>
          <p style={{ marginBottom: "0.75rem", opacity: 0.8 }}>
            Released {r.date}. {r.notes}
          </p>
          {r.served ? (
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              <code>{urlFor(r)}</code>
            </pre>
          ) : (
            <p>
              <em>
                No longer served from this site. Fetch this version from npm (
                <code>
                  @saccadejs/core@{r.version}/models/{r.file}
                </code>
                ) or the archived copy.
              </em>
            </p>
          )}
          <table>
            <tbody>
              <tr>
                <th>sha256</th>
                <td>
                  <code style={{ wordBreak: "break-all" }}>{r.sha256}</code>
                </td>
              </tr>
              <tr>
                <th>Size</th>
                <td>{mb(r.bytes)}</td>
              </tr>
              <tr>
                <th>Preprocessing contract</th>
                <td>{r.contract}</td>
              </tr>
              <tr>
                <th>Input</th>
                <td>
                  <code>{r.io.input.name}</code> {JSON.stringify(r.io.input.shape)}{" "}
                  {r.io.input.dtype}, range <code>{r.io.inputRange}</code>
                </td>
              </tr>
              <tr>
                <th>Output</th>
                <td>
                  <code>{r.io.output.name}</code> {JSON.stringify(r.io.output.shape)}{" "}
                  {r.io.output.dtype}
                </td>
              </tr>
              {"weightOutput" in r.io && r.io.weightOutput ? (
                <tr>
                  <th>Calibration weight</th>
                  <td>
                    <code>{r.io.weightOutput.name}</code> {JSON.stringify(r.io.weightOutput.shape)}{" "}
                    {r.io.weightOutput.dtype}, one per frame, in [0, 1]
                  </td>
                </tr>
              ) : null}
              <tr>
                <th>ONNX opset</th>
                <td>{r.io.opset}</td>
              </tr>
              <tr>
                <th>Trained checkpoint</th>
                <td>
                  <code>{r.provenance.wandb}</code>
                </td>
              </tr>
              <tr>
                <th>Exported</th>
                <td>{r.provenance.exportedAt}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
