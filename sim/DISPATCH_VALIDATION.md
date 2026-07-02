# Simulator dispatch validation & model changes (2026-07)

Record of a validation exercise on the `/sim` half-hourly dispatch model: running it at
**historic installed capacities** and comparing its outturn generation against the actual
metered EMI record, year by year and half-hour by half-hour. Four model changes came out of
it. Written up here so we can refer back before/while writing it up on the website.

## How it was validated

Ran the live simulator headlessly (Puppeteer + system Chrome, sim served over localhost so the
Google Sheets `gviz` fetch works), pinned to one weather year at a time, and read two internal
objects:
- `gMoBase` — monthly outturn simulated at **historic capacity** (`buildBaselineParams`)
- `gRawData` / `gPpBase` — the actual **metered** record (and the per-period baseline dispatch)

Compared per source, per island, per year, and per half-hour. Reproducible; the harness scripts
were kept out of the repo but the method is the above.

## The four changes (all in `sim/index.html`)

1. **Wood as must-run pinned to metered output.** Wood/biomass is mill co-generation —
   fuel-limited and steady, not economically dispatchable. It was being merit-ordered up to its
   510 MW nameplate (running at ~53% CF, ~2,350 GWh vs the real ~243 GWh). Now treated like
   geothermal: `niWood = row.NI_Wood`, added to `niFixed`, removed from the thermal merit order.
   Fixes a ~2,100 GWh artifact that was displacing real gas/coal.

2. **HVDC transmission losses (`HVDC_LOSS = 0.04`).** The interisland link was lossless. Power
   sent now arrives de-rated ~4%, so the sending island must generate more to cover a deficit.
   Applied at every transfer (surplus, cross-island flex hydro, reservoir, thermal-over-HVDC);
   tracked in a new `hvdcLoss` field. Worth ~110–145 GWh/yr.

3. **HVDC-adjusted per-island loss factors.** The old transmission-loss proxy was
   `1 − demand/gen` per island, capped 0–10% — confounded by HVDC (it read the ~2 TWh
   interisland flow as "loss" on SI and hid real losses behind imports on NI, floor/cap binding
   in 40–63% of periods). Replaced with a single annual per-island factor from the grid energy
   balance: `loss = (gen + HVDC_in − demand − HVDC_out) / (gen + HVDC_in)`.
   For 2024: **NI 8.6%, SI 6.4%** (national 8.2%). Closed a ~1 TWh generation gap.

4. **Water-value reservoir floor (`WATER_VALUE_FLOOR = 0.45`).** The model was draining the
   lakes to displace every last tonne of fossil (SI hydro +1.1 TWh above metered). Now storage
   below 45% of capacity is treated as high water value and conserved — only "surplus" water is
   spent, so winter thermal runs instead, as it did in reality. Not knife-edge: 0.30 and 0.45
   give identical historic results (2024's reservoir sat near its 25% start all year). It only
   bites in genuinely wet / high-VRE scenarios where the reservoir fills above the floor.

## Why coal ran in reality (the operability we were missing)

Investigated *when* NI coal actually ran in 2024 (half-hourly). It was a **winter energy
resource**, not a peaker/transmission fix:
- Ran 72% of periods (~300 MW avg), strongly seasonal — peak July (398 GWh), ~0 in Oct–Dec.
- Correlations: NI gas **+0.69**, NI demand +0.52, HVDC SI→NI **−0.39**, wind −0.24,
  total hydro +0.05.
- HVDC **never** near its northward cap (0% of periods) → not a transmission constraint.
- Persistent 165–180 MW overnight floor → minimum-generation / must-run commitment.

Conclusion: coal reflects **hydro storage risk management** (water value) — operators run
winter thermal rather than emptying reservoirs. That's exactly what change #4 restores. A
thermal must-run floor would be a smaller second-order refinement (not done).

## EMI data definitions (confirmed)

- `NI/SI_Demand_MW` = EMI `Grid_export` → **grid-exit (GXP offtake), not end-use.**
- Generation columns = EMI `Generation_MD` metered at **POC** → grid injection, grid-connected
  plant only.
- Both are grid-boundary, so `gen − demand` **is** transmission loss by definition. This is why
  reproducing the metered gap (change #3) is correct rather than an accounting fudge. The 8.2%
  is above Transpower's ~4% headline, which points at half-hourly data-quality/embedded-gen
  effects in the raw series — noted, doesn't change the decision.

## Validation results

### Annual — historic capacities vs metered (Δ%), after dynamic-capacity fix (change #5)

| Metric      | 2022  | 2023  | 2024  | 2025  |
|-------------|------:|------:|------:|------:|
| Hydro       | −0.0% | −0.0% | −0.0% | −0.0% |
| Geo / Wood  |  0.0% |  0.0% |  0.0% |  0.0% |
| Wind        | +0.0% | +0.0% | +0.0% | +0.0% |
| Solar       |  n/a¹ |  n/a¹ | +0.0% | +0.0% |
| National gen| −0.1% | −0.2% | −0.2% | −0.2% |
| Fossil (g+c)| −0.8% | −1.3% | −1.4% | −1.3% |

¹ No grid solar existed in 2022/23 (metered = 0; sim = 0). Every generation source the model
reproduces now matches the metered record to a fraction of a percent; the only material
divergence is the small emergent fossil residual (the point of the tool). Half-hourly fossil and
HVDC still correlate r ≈ 0.98–0.99. Coal and gas treated as equivalent.

### Half-hourly — 2024, historic capacities (17,568 periods)

| Series    | mean met | mean mod | bias | MAE | RMSE | corr r |
|-----------|---------:|---------:|-----:|----:|-----:|-------:|
| NI fossil |      692 |      702 |  +9  |  47 |   57 | 0.991 |
| HVDC S→N  |      239 |      241 |  +2  |  20 |   28 | 0.994 |
| HVDC N→S  |       69 |       68 |  −1  |   9 |   18 | 0.991 |
| NI hydro  |      675 |      675 |   0  |   0 |    1 | 1.00  |
| SI hydro  |    1,913 |    1,913 |   0  |   0 |    2 | 1.00  |
| NI wind   |      394 |      387 |  −7  |   7 |    9 | 1.00  |

Emergent outputs (fossil, HVDC) track at **r ≈ 0.99** half-hourly, including the fossil diurnal
shape (evening peak captured). Hydro/wind are ~perfect but partly by construction (pinned to
metered inputs). No systematic time-of-day or seasonal divergence; worst single half-hour is a
−212 MW fossil miss on a winter night.

## Change #5 — dynamic (dated) VRE capacity

The original wind/solar scaling divided the metered series by a single **static** capacity figure
(`capacity_perIsland`), which was stale and mixed grid + distributed solar — giving a phantom ~7%
solar CF and a −53% solar undercount in 2025 (wind −3%). Fixed end-to-end:

- **Pipeline** (`gas-script/nz-generation-importer.js`): built a **dated** capacity series from EMI
  `DispatchedGenerationPlant` (per-unit nameplate + `DateCommissioned`/`EffectiveStartDate`),
  **restricted to the POCs that appear as generation in `Generation_MD`** (transmission-metered
  grid plant only — embedded farms that net into demand are excluded). Written as four per-HH
  columns in `data_perIsland`: `NI/SI_Solar_Cap_MW`, `NI/SI_Wind_Cap_MW`. Backfilled 2021–2025.
- **Sim** (`simulate`): scale `output(t) = gen(t) × targetMW / C(t)`. The baseline (`rawVRE`) passes
  the metered series through unchanged → validation exact; scenarios scale against the dated `C(t)`.
  Removed the obsolete solar-fallback and SI gap-fill (they invented phantom solar).
- **Yields**: utility solar corrected against the dynamic CF (target now **1,700 kWh/kWp**, ~21% CF —
  the metered fleet's real figure); rooftop kept separate at **1,200 kWh/kWp** via its own
  correction on the static-capacity basis the per-home model uses.

Result: solar −53% → **+0.0%**, wind −3% → **+0.0%** (see table above).

## Blueprint 2030 preset — redesigned

Searched the inputs for minimum gas + cost. Firm **geothermal** is the only lever that moves the
overnight national-wind-calm peak; capacity-market home batteries (50% reserve) shave evening gas
and *raise* home self-sufficiency. Final preset: **3 GW wind, 2.5 GW utility solar (1,700 kWh/kWp),
250 MW geothermal, 1 GW/8 GWh grid battery, 55% homes w/ 20 kWh batteries + rooftop export.**
Result (2025): 0 everyday gas, **200 GWh dry-year gas** (~98% below today), 100% renewable, $71/MWh.
(500 MW geo would cut dry-year gas to 71 GWh AND halve the firm reserve to ~590 MW for +$1/MWh;
250 MW chosen for lower capex — it more than halves the fuel but keeps the full ~1 GW gas reserve.)
`SCENARIO_METRICS` tile figures regenerated to match.

Related wind-calm finding: [[wind-lulls-are-synoptic]] — NZ deep wind lulls are national/synoptic;
geographic diversity across the existing onshore fleet does not shrink them.

## Remaining residual

- **Gas/coal split**: model runs fossil as gas (cheapest); reality split gas+coal due to gas fuel
  limits. Immaterial while coal≈gas for our purposes; would need a gas fuel-availability cap.

## Status

Changes #1–#5 implemented in `sim/index.html`, dynamic capacity in the Apps Script pipeline, the
Blueprint redesigned, and website "How the Simulation Was Validated" section added. Validated
2021–2025 from a local cache (`.data-cache/`, gitignored). Committed 2026-07-02.
