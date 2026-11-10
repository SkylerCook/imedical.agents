/* Run in the explicitly selected frame. This file is a diagnostic tool, not a page asset. */
(function (root) {
    "use strict";

    function collectUiMetrics(options) {
        var doc = typeof document === "undefined" ? null : document;
        var win = doc && doc.defaultView;
        var targets = options && options.targets;
        var names = [];
        var result;

        if (!doc || !win || typeof win.getComputedStyle !== "function") {
            throw new Error("Select an accessible browser frame before collecting UI metrics.");
        }
        if (!Array.isArray(targets) || !targets.length) {
            throw new TypeError("targets must be a non-empty array of {name, selector}.");
        }
        targets.forEach(function (target) {
            if (!target || typeof target.name !== "string" || !target.name.trim() ||
                    typeof target.selector !== "string" || !target.selector.trim()) {
                throw new TypeError("Each target requires a non-empty name and selector.");
            }
            if (names.indexOf(target.name) !== -1) {
                throw new TypeError("Target names must be unique.");
            }
            names.push(target.name);
        });

        function number(value) {
            return typeof value === "number" && isFinite(value) ? value : null;
        }

        function measure(target) {
            var entry = { name: target.name, matchCount: null, metrics: null, warnings: [] };
            var matches;
            var element;
            var style;
            var rect;
            try {
                matches = doc.querySelectorAll(target.selector);
            } catch (error) {
                entry.warnings.push("invalid-selector");
                return entry;
            }
            entry.matchCount = matches.length;
            if (matches.length !== 1) {
                entry.warnings.push(matches.length ? "multiple-matches" : "target-not-found");
                return entry;
            }
            try {
                element = matches[0];
                style = win.getComputedStyle(element);
                rect = element.getBoundingClientRect();
                entry.metrics = {
                    rect: {
                        x: number(typeof rect.x === "number" ? rect.x : rect.left),
                        y: number(typeof rect.y === "number" ? rect.y : rect.top),
                        width: number(rect.width),
                        height: number(rect.height)
                    },
                    client: { width: number(element.clientWidth), height: number(element.clientHeight) },
                    scroll: { width: number(element.scrollWidth), height: number(element.scrollHeight) },
                    offset: { width: number(element.offsetWidth), height: number(element.offsetHeight) },
                    box: {
                        sizing: style.boxSizing,
                        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
                        border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]
                    },
                    layout: {
                        display: style.display,
                        position: style.position,
                        overflowX: style.overflowX,
                        overflowY: style.overflowY,
                        visibility: style.visibility,
                        opacity: style.opacity,
                        hasClientRect: element.getClientRects().length > 0
                    }
                };
                if (!entry.metrics.layout.hasClientRect) {
                    entry.warnings.push("no-client-rect");
                }
                if (element.scrollWidth > element.clientWidth) {
                    entry.warnings.push("horizontal-overflow");
                }
                if (element.scrollHeight > element.clientHeight) {
                    entry.warnings.push("vertical-overflow");
                }
            } catch (error) {
                entry.metrics = null;
                entry.warnings.push("measurement-unavailable");
            }
            return entry;
        }

        result = {
            viewport: {
                width: number(win.innerWidth),
                height: number(win.innerHeight),
                devicePixelRatio: number(win.devicePixelRatio)
            },
            targets: targets.map(measure)
        };
        return result;
    }

    if (typeof module === "object" && module.exports) {
        module.exports = collectUiMetrics;
    } else {
        root.collectUiMetrics = collectUiMetrics;
    }
}(typeof window === "undefined" ? this : window));
