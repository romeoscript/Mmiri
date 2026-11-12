//! The oracle as a Wasm component.
//!
//!   stdin   {"lat_e4":64500,"lon_e4":75100,"start":20250415,"days":30}
//!   stdout  {"mm_x10":536,"days_valid":30,"source":"NASA POWER PRECTOTCORR"}
//!
//! Built for `wasm32-wasip2`, which is the target that can make outbound HTTP requests.
//! The contract pins this binary by its sha256, so OutLayer's worker refuses to run
//! anything whose bytes do not match — meaning the question a settlement rests on is "do
//! you trust the TEE and NASA", not "did the right code run".
//!
//! Everything except the fetch lives in `lib.rs` and is covered by host tests.

#[cfg(target_arch = "wasm32")]
mod wasm {
    use mmiri_oracle::{Input, NasaResponse, nasa_url, window_total};
    use wstd::http::{Body, Client, Request};
    use wstd::io::AsyncRead;

    pub async fn run() -> Result<String, String> {
        // Terms arrive on stdin as the JSON string the contract passed as `input_data`.
        let mut raw = Vec::new();
        wstd::io::stdin()
            .read_to_end(&mut raw)
            .await
            .map_err(|e| format!("could not read stdin: {e}"))?;

        let input: Input = serde_json::from_slice(&raw)
            .map_err(|e| format!("could not parse terms: {e}"))?;

        if input.days == 0 || input.days > 366 {
            return Err(format!("days out of range: {}", input.days));
        }

        let url = nasa_url(&input);
        let req = Request::get(&url)
            .body(Body::empty())
            .map_err(|e| format!("could not build request: {e}"))?;

        let mut resp = Client::new()
            .send(req)
            .await
            .map_err(|e| format!("request to NASA POWER failed: {e}"))?;

        let status = resp.status().as_u16();
        if status != 200 {
            return Err(format!("NASA POWER returned {status}"));
        }

        let parsed: NasaResponse = resp
            .body_mut()
            .json()
            .await
            .map_err(|e| format!("could not parse NASA response: {e}"))?;

        // If NASA ever changes its missing-value marker, refuse rather than silently
        // treating -999 as 999 mm of rain.
        if let Some(h) = &parsed.header {
            if let Some(f) = h.fill_value {
                if f != mmiri_oracle::FILL {
                    return Err(format!("unexpected fill_value {f}"));
                }
            }
        }

        let out = window_total(&parsed.properties.parameter.prectotcorr, input.start, input.days);
        serde_json::to_string(&out).map_err(|e| format!("could not serialise output: {e}"))
    }
}

#[cfg(target_arch = "wasm32")]
#[wstd::main]
async fn main() {
    match wasm::run().await {
        Ok(json) => println!("{json}"),
        Err(e) => {
            // A failure must not look like a reading. The contract leaves the policy
            // Active when it cannot parse a result, so `settle` can simply be retried.
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!(
        "mmiri-oracle is a Wasm component. Build it with:\n\
         \n    cargo build --release --target wasm32-wasip2\n\n\
         Its logic is covered by `cargo test` on the host; only the HTTP fetch is\n\
         WASI-specific. See scripts/build-oracle.\n"
    );
    std::process::exit(1);
}
