import type { QuartzComponent } from "../quartz/components/types";
// @ts-ignore: Quartz imports inline scripts as strings.
import behavior from "./appearance.inline";
// @ts-ignore: Quartz imports inline scripts as strings.
import initial from "./appearance-before.inline";
export const Appearance: QuartzComponent = () => (
  <details class="appearance-panel">
    <summary>Appearance</summary>
    <div class="navigation-panel-body">
      {[
        [
          "text",
          "Text",
          [
            ["small", "Small"],
            ["standard", "Standard"],
            ["large", "Large"],
          ],
        ],
        [
          "width",
          "Width",
          [
            ["standard", "Standard"],
            ["wide", "Wide"],
          ],
        ],
        [
          "color",
          "Color",
          [
            ["automatic", "Automatic"],
            ["light", "Light"],
            ["dark", "Dark"],
          ],
        ],
      ].map(([name, label, choices]) => (
        <fieldset>
          <legend>{label as string}</legend>
          {(choices as string[][]).map(([value, title]) => (
            <label>
              <input
                type="radio"
                name={`appearance-${name}`}
                value={value}
                defaultChecked={
                  value === (name === "color" ? "automatic" : "standard")
                }
              />
              {title}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  </details>
);
Appearance.beforeDOMLoaded = initial;
Appearance.afterDOMLoaded = behavior;
