import {
    ButtonComponent,
    ExtraButtonComponent,
    ItemView,
    Notice,
    Platform,
    TextAreaComponent,
    WorkspaceLeaf
} from "obsidian";
import type DiceRollerPlugin from "src/main";
import { StackRoller } from "src/rollers/dice/stack";
import { ExpectedValue } from "../types/api";
import { API } from "../api/api";
import { type DiceIcon, IconManager } from "./view.icons";
import { Icons } from "src/utils/icons";
import { nanoid } from "nanoid";
import DiceTray from "./ui/DiceTray.svelte";
import type { RenderableRoller } from "src/rollers/roller";

/* import { Details } from "@javalent/utilities"; */

export const VIEW_TYPE = "DICE_ROLLER_VIEW";

export interface ViewResult {
    original: string;
    displayOriginal?: string;
    wildDieActive?: boolean;
    resultText: string;
    result: string | number;
    timestamp: number;
    id: string;
}

export default class DiceView extends ItemView {
    noResultsEl: HTMLSpanElement;
    rollButton: ButtonComponent;
    saveButton: ExtraButtonComponent;
    stack: StackRoller;
    gridEl: HTMLDivElement;
    formulaEl: HTMLDivElement;
    get customFormulas() {
        return this.plugin.data.customFormulas;
    }
    custom = "";
    #wild = true;
    #add = 0;

    formulaComponent: TextAreaComponent;
    resultEl: HTMLDivElement;

    #icons = IconManager;
    constructor(public plugin: DiceRollerPlugin, public leaf: WorkspaceLeaf) {
        super(leaf);
        this.contentEl.addClass("dice-roller-view");

        this.addChild(this.#icons);

        for (const icon of this.plugin.data.icons) {
            this.#icons.registerIcon(icon.id, icon.shape, icon.text);
        }

        this.registerEvent(
            this.plugin.app.workspace.on(
                "dice-roller:new-result",
                async (roller: RenderableRoller) => {
                    if (
                        this.plugin.data.addToView ||
                        roller.getSource() == VIEW_TYPE
                    ) {
                        const stack =
                            roller instanceof StackRoller ? roller : null;
                        await this.addResult({
                            result: roller.getResultText(),
                            original: roller.original,
                            displayOriginal: stack?.getDisplayFormula(),
                            wildDieActive: stack?.children.some(
                                (dice) => dice.hasWildDie
                            ),
                            resultText: roller.getTooltip(),
                            timestamp: new Date().valueOf(),
                            id: nanoid(12)
                        });
                    }
                }
            )
        );
    }
    async onOpen() {
        //build ui

        this.display();
    }

    async display() {
        this.contentEl.empty();

        this.gridEl = this.contentEl.createDiv("dice-roller-grid");
        this.formulaEl = this.contentEl.createDiv("dice-roller-formula");

        const headerEl = this.contentEl.createDiv("results-header-container");
        headerEl.createEl("h4", { cls: "results-header", text: "Results" });
        new ExtraButtonComponent(headerEl.createDiv("clear-all"))
            .setIcon(Icons.DELETE)
            .setTooltip("Clear All")
            .onClick(async () => {
                this.resultEl.empty();
                this.resultEl.append(this.noResultsEl);
                this.plugin.data.viewResults = [];
                await this.plugin.saveSettings();
            });
        const resultsEl = this.contentEl.createDiv(
            "dice-roller-results-container"
        );
        this.resultEl = resultsEl.createDiv("dice-roller-results");
        this.noResultsEl = this.resultEl.createSpan({
            text: "No results yet! Roll some dice to get started :)"
        });

        for (const result of this.plugin.data.viewResults) {
            this.addResult(result, false);
        }

        this.buildButtons();
        this.buildFormula();
    }
    #formula: Map<DiceIcon, number> = new Map();
    buildButtons() {
        this.gridEl.empty();

        const buttons = this.gridEl.createDiv("dice-buttons");
        for (const icon of this.plugin.data.icons) {
            this.#icons.registerIcon(icon.id, icon.shape, icon.text);
            new ExtraButtonComponent(buttons.createDiv("dice-button"))
                .setIcon(icon.id)
                .extraSettingsEl.onClickEvent((evt) => {
                    if (evt.type === "auxclick") {
                        this.roll(icon.formula);
                        return;
                    }
                    if (!this.#formula.has(icon)) {
                        this.#formula.set(icon, 0);
                    }
                    let amount = this.#formula.get(icon) ?? 0;
                    amount += evt.getModifierState("Shift") ? -1 : 1;
                    this.#formula.set(icon, amount);
                    this.setFormula();
                });
        }

        const wildNormal = this.gridEl.createDiv("wild-normal");

        new ExtraButtonComponent(wildNormal)
            .setIcon(Icons.MINUS)
            .onClick(() => {
                this.#add -= 1;
                this.setFormula();
            });
        const wild = new ButtonComponent(wildNormal)
            .setButtonText("WILD")
            .onClick(() => {
                this.#wild = true;
                wild.setCta();
                norm.removeCta();
            });
        const norm = new ButtonComponent(wildNormal)
            .setButtonText("NORM")
            .onClick(() => {
                this.#wild = false;
                norm.setCta();
                wild.removeCta();
            });

        if (this.#wild) {
            wild.setCta();
        } else {
            norm.setCta();
        }
        new ExtraButtonComponent(wildNormal)
            .setIcon(Icons.PLUS)
            .onClick(() => {
                this.#add += 1;
                this.setFormula();
            });

        new DiceTray({
            target: this.gridEl,
            props: {
                settings: this.plugin.data,
                plugin: this.plugin,
                view: this
            }
        });
    }
    setFormula() {
        if (!this.#formula.size && !this.#add) {
            this.formulaComponent.inputEl.value = "";
            return;
        }
        const formula: { formula: string; max: number; sign: "+" | "-" }[] = [];
        for (const [icon, amount] of this.#formula) {
            if (!amount) continue;
            const sign = amount < 0 ? "-" : "+";
            const diceFormula = /^(?:1)?d(\d|%|F)+$/.test(icon.formula)
                ? `${Math.abs(amount)}${icon.formula.replace(/^1/, "")}`
                : `${Math.abs(amount)} * (${icon.formula})`;
            const roller = API.getRoller(icon.formula, VIEW_TYPE);
            if (roller == null) continue;
            if (!(roller instanceof StackRoller)) continue;
            roller.buildDiceTree();
            roller.calculate();
            formula.push({ formula: diceFormula, max: roller.max, sign });
        }
        formula.sort((a, b) => b.max - a.max);
        const str: string[] = [];
        for (let index = 0; index < formula.length; index++) {
            const instance = formula[index];
            if (index === 0 && instance.sign === "-") {
                instance.formula = `${instance.sign}${instance.formula}`;
            } else if (index > 0) {
                str.push(instance.sign);
            }
            str.push(`${instance.formula}`);
        }
        if (this.#add !== 0) {
            if (str.length > 0) {
                str.push(this.#add > 0 ? "+" : "-");
            }
            str.push(`${Math.abs(this.#add)}`);
        }
        this.formulaComponent.inputEl.value = str.join(" ");
    }
    applyTrayWildDie(formula: string) {
        return formula.replace(
            /(\d*[dD]6)(?:\s*(?:[nN][wW]|[wW]))?(?!\d|%|F|\[)/g,
            `$1${this.#wild ? "w" : "nw"}`
        );
    }
    async roll(formula = this.formulaComponent.inputEl.value) {
        if (!formula) {
            return;
        }
        formula = this.applyTrayWildDie(formula);
        this.rollButton.setDisabled(true);
        const opts = {
            ...API.getRollerOptions(this.plugin.data)
        };
        if (opts.expectedValue == ExpectedValue.None) {
            opts.expectedValue = ExpectedValue.Roll;
        }
        try {
            const roller = await API.getRoller(formula, VIEW_TYPE, opts);
            if (roller == null) return;
            if (!(roller instanceof StackRoller)) {
                throw new Error("The Dice Tray only supports dice rolls.");
            }
            roller.iconEl.detach();
            roller.containerEl.onclick = null;
            roller.buildDiceTree();
            if (!roller.children.length) {
                throw new Error("No dice.");
            }
            await roller.roll(this.plugin.data.renderer).catch((e) => {
                throw e;
            });
        } catch (e: any) {
            new Notice("Invalid Formula: " + e.message);
        } finally {
            this.rollButton.setDisabled(false);
            this.buildButtons();
            this.#formula = new Map();
            this.#add = 0;
            this.setFormula();
        }
    }
    buildFormula() {
        this.formulaEl.empty();
        this.formulaComponent = new TextAreaComponent(this.formulaEl)
            .setPlaceholder("Dice Formula")
            .onChange((v) => (this.#formula = new Map()));

        const buttons = this.formulaEl.createDiv("action-buttons");
        this.saveButton = new ExtraButtonComponent(buttons)
            .setIcon(Icons.SAVE)
            .setTooltip("Save Formula")
            .onClick(() => this.save());
        this.saveButton.extraSettingsEl.addClass("dice-roller-roll");

        this.rollButton = new ButtonComponent(buttons)
            .setIcon(Icons.DICE)
            .setCta()
            .setTooltip("Roll")
            .onClick(() => this.roll());
        this.rollButton.buttonEl.addClass("dice-roller-roll");
    }
    save() {
        if (!this.formulaComponent.inputEl.value) return;
        this.plugin.data.customFormulas.push(
            this.formulaComponent.inputEl.value
        );
        this.buildButtons();
        this.plugin.saveSettings();
    }

    Formatter = new Intl.DateTimeFormat(
        localStorage.getItem("language") ?? "en-US",
        {
            dateStyle: "medium",
            timeStyle: "short"
        }
    );

    private async addResult(result: ViewResult, save = true) {
        if (this.noResultsEl) {
            this.noResultsEl.detach();
        }
        const resultEl = createDiv("view-result");
        const topPaneEl = resultEl.createDiv("result-actions");
        const displayOriginal =
            result.displayOriginal ?? result.original.replace(/nw/giu, "");
        const displayResultText = result.resultText.replace(/nw/giu, "");
        const reroll = new ExtraButtonComponent(topPaneEl)
            .setIcon(Icons.DICE)
            .setTooltip("Roll Again")
            .onClick(() => this.roll(result.original));
        reroll.extraSettingsEl.addClass("dice-result-reroll");
        if (result.wildDieActive) {
            reroll.extraSettingsEl.addClass("wild-die-active");
        }
        topPaneEl.createSpan({
            text: displayOriginal
        });

        const copy = new ExtraButtonComponent(topPaneEl)
            .setIcon(Icons.COPY)
            .setTooltip("Copy Result")
            .onClick(async () => {
                await navigator.clipboard.writeText(`${displayResultText}`);
            });
        copy.extraSettingsEl.addClass("dice-content-copy");
        if (Platform.isMobile) {
            resultEl.createSpan({
                cls: "dice-content-result",
                text: `${displayResultText}`
            });
        }
        resultEl.createEl("strong", {
            attr: {
                "aria-label": displayResultText
            },
            text: `${result.result}`
        });

        const context = resultEl.createDiv("result-context");

        context.createEl("em", {
            cls: "result-timestamp",
            text: this.Formatter.format(result.timestamp)
        });
        new ExtraButtonComponent(context)
            .setIcon(Icons.DELETE)
            .onClick(async () => {
                resultEl.detach();
                if (this.resultEl.children.length === 0) {
                    this.resultEl.prepend(this.noResultsEl);
                }

                this.plugin.data.viewResults.splice(
                    this.plugin.data.viewResults.findIndex(
                        (r) => r.id === result.id
                    ),
                    1
                );
                await this.plugin.saveSettings();
            });

        this.resultEl.prepend(resultEl);
        if (save) {
            this.plugin.data.viewResults.push(result);
            this.plugin.data.viewResults = this.plugin.data.viewResults.slice(
                0,
                100
            );
            await this.plugin.saveSettings();
        }
    }

    getDisplayText() {
        return "Dice Tray";
    }
    getViewType() {
        return VIEW_TYPE;
    }
    getIcon() {
        return Icons.DICE;
    }
    async onClose() {
        await super.onClose();
    }
}
