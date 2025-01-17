import extend from 'extend';
import getAnimator from './Animation';

const defaultOptions = {
    initialViewBox: null,
    animationTime: 200,
    limits: null,
    eventMagnet: null,
    zoom: {
        factor: 0.25,
        minZoom: 0.1,
        maxZoom: 5,
        events: {
            mouseWheel: true,
            doubleClick: true,
            pinch: true
        },
        callback: function(multiplier) {}
    },
    pan: {
        factor: 100,
        events: {
            drag: true,
            dragMouseButton: 1,
            dragCursor: "move"
        },
        callback: function(coordinates) {}
    }
};

const defaultViewBox = {
    x: 0,
    y: 0,
    width: 1000,
    height: 1000
};

/**
 * Parse the viewbox string as defined in the spec for the svg tag.
 *
 * @param {String} viewBoxString
 *   A valid value of the `viewBox` attribute.
 *
 * @return {Object} viewBox
 *   A viewbox object. Contains numbers, in the format `{x, y, width, height}`.
 */
const parseViewBoxString = string => {
    const viewBox = string.replace(/\s+/g, " ").split(" ");
    return {
        x: parseFloat(viewBox[0]),
        y: parseFloat(viewBox[1]),
        width: parseFloat(viewBox[2]),
        height: parseFloat(viewBox[3])
    };
};

/**
 * Transform the point from page co-ordinate system to SVG co-ordinate system
 *
 * @param {SVGElement} svgRoot
 *   The `<svg>` DOM object
 *
 * @param {Object} point
 *   Coordinates of the point. Contains numbers, in the format `{x, y}`.
 *
 * @return {Object}
 *   Coordinates of the point in SVG co-ordinate system. Contains numbers, in the format `{x, y}`.
 */
const coordinateTransform = function(svgRoot, point) {
    const pos = svgRoot.createSVGPoint();
    pos.x = parseInt(point.x, 10);
    pos.y = parseInt(point.y, 10);
    return pos.matrixTransform(svgRoot.getScreenCTM().inverse());
};

/**
 * Get the mouse or first touch position from the `event`, relative to the SVG viewBox.
 *
 * @param {SVGElement} svgRoot
 *   The `<svg>` DOM object
 *
 * @param {MouseEvent|TouchEvent|jQueryEvent} event
 *   The DOM or jQuery event.
 *
 * @return {Object}
 *   Coordinates of the event. Contains numbers, in the format `{x, y}`.
 */
const getViewBoxCoordinatesFromEvent = function(svgRoot, e) {
    //If modified event get original event
    e = e.originalEvent || e;

    if (/touch/i.test(e.type)) {
        //Event has touch information
        if (e.touches !== null && e.touches.length) {
            e = e.touches[0];
        }
        //If touchend get the required info from changedTouches
        else if (e.changedTouches !== null && e.changedTouches.length) {
            e = e.changedTouches[0];
        }
    }

    const position = {
        x: e.clientX,
        y: e.clientY
    };
    return coordinateTransform(svgRoot, position);
};

/**
 * Create and set viewBox attribute of given SVG element
 *
 * @param {SVGElement} svg
 *   The `<svg>` DOM object
 *
 * @param {Object} viewBox
 *   A viewbox object. Contains numbers, in the format `{x, y, width, height}`.
 */
const setViewBox = function(svg, viewBox) {
    svg.setAttribute("viewBox", [viewBox.x, viewBox.y, viewBox.width, viewBox.height].join(' '));
};

/**
 * Get distance between fingers for two finger touch event
 *
 * @param {TouchEvent|jQueryEvent} event
 *   The DOM or jQuery event.
 */
const touchDistance = function(event) {
    const touches = (event.originalEvent || event).touches;
    return Math.sqrt(Math.pow(touches[0].clientX - touches[1].clientX, 2) + Math.pow(touches[0].clientY - touches[1].clientY, 2));
};

/**
 * Check if the event is a two finger touch event
 *
 * @param {TouchEvent|jQueryEvent} event
 *   The DOM or jQuery event.
 */
const isDoubleTouch = function(event) {
    const touches = (event.originalEvent || event).touches;
    return touches.length === 2;
};

/**
 * Get mid point of fingers for two finger touch event in SVG co-ordinate system
 *
 * @param {SVGElement} svg
 *   The `<svg>` DOM object
 *
 * @param {TouchEvent|jQueryEvent} event
 *   The DOM or jQuery event.
 */
const touchCenter = function(svg, event) {
    const touches = (event.originalEvent || event).touches;
    return coordinateTransform(svg, {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    });
};

class SVGPanZoom {
    constructor(svg, options) {
        if (!(svg instanceof SVGElement)) {
            throw new Error('Invalid Parameters. Firt parameter to SVGPanZoom should be an svg element');
        }

        this.svg = svg;
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

        let viewBox = extend({}, svg.viewBox.baseVal);
        if (viewBox.x === 0 && viewBox.y === 0 && viewBox.width === 0 && viewBox.height === 0) {
            viewBox = defaultViewBox;
        }

        // Option validations
        options: {
            let _options;
            Object.defineProperty(this, 'options', {
                get: function() {
                    return _options;
                },
                set: function(options) {
                    if (_options) {
                        throw new Error('Options cannot be overriden');
                    }
                    _options = options;
                }
            });
        }

        setOptions: {
            const self = this;
            let _initialViewBox, _animationTime, _eventMagnet, _limits;

            this.options = {
                get initialViewBox() {
                    return _initialViewBox;
                },
                set initialViewBox(value) {
                    // Set initial viewbox
                    if (value !== null) {
                        if (typeof value === "string") {
                            viewBox = parseViewBoxString(value);
                        } else if (typeof value === "object") {
                            viewBox = extend({}, defaultViewBox, value);
                        } else {
                            throw new Error('initialViewBox is of invalid type');
                        }
                    }

                    _initialViewBox = extend({}, viewBox);
                },
                get animationTime() {
                    return _animationTime;
                },
                set animationTime(value) {
                    _animationTime = value || 0;
                },
                get eventMagnet() {
                    return _eventMagnet;
                },
                set eventMagnet(value) {
                    self.destroy();
                    _eventMagnet = value || svg;
                    self._setupEvents();
                },
                get limits() {
                    return _limits;
                },
                set limits(value) {
                    _limits = {};
                    const directionalLimits = ((value ? value : (value === 0 ? 0 : 15)) + '').trim().split(' ');

                    horizontal: {
                        const multiplier = Number((directionalLimits[1] || directionalLimits[0]).replace(/%/g, '')) / 100;
                        const horizontalSizeIncrement = viewBox.height * multiplier;
                        _limits.minX = viewBox.x - horizontalSizeIncrement;
                        _limits.maxX = viewBox.x + horizontalSizeIncrement;
                    }

                    vertical: {
                        const multiplier = Number(directionalLimits[0].replace(/%/g, '')) / 100;
                        const verticalSizeIncrement = viewBox.width * multiplier;
                        _limits.minY = viewBox.y - verticalSizeIncrement;
                        _limits.maxY = viewBox.y + verticalSizeIncrement;
                    }
                }
            };
        }

        // Animate method
        const animate = getAnimator(state => setViewBox(svg, state));

        // Getter for ViewBox
        this.getViewBox = () => extend({}, viewBox);

        // Setter for ViewBox
        this.setViewBox = (x, y, width, height, animationTime, callback) => {
            if (typeof animationTime === 'function') {
                callback = animationTime;;
                animationTime = null;
            }

            if (!animationTime && animationTime !== 0) {
                animationTime = this.options.animationTime;
            }

            const oldBox = this.getViewBox();

            viewBox = {
                x: (!!x || x === 0) ? x : viewBox.x,
                y: (!!y || y === 0) ? y : viewBox.y,
                width: (!!width || width === 0) ? width : viewBox.width,
                height: (!!height || height === 0) ? height : viewBox.height
            };

            this.validateLimits(viewBox);

            if (animationTime > 0) {
                animate(oldBox, viewBox, animationTime, callback);
            } else {
                setViewBox(svg, viewBox);
                (callback || Function.prototype)();
            }

            // Chaining
            return this;
        };

        // Pan methods
        pan: {
            function panMethod(callback, amount, animationTime) {
                if (!this.options.pan) {
                    return this;
                }

                if (!amount && amount !== 0) {
                    amount = this.options.pan.factor
                    if (!amount) {
                        return this;
                    }
                }

                return callback(amount, animationTime);
            }

            this.panLeft = panMethod.bind(this, (amount, animationTime) => (
                this.pan(viewBox.x - amount, null, animationTime)
            ));

            this.panRight = panMethod.bind(this, (amount, animationTime) => (
                this.pan(viewBox.x + amount, null, animationTime)
            ));

            this.panUp = panMethod.bind(this, (amount, animationTime) => (
                this.pan(null, viewBox.y - amount, animationTime)
            ));

            this.panDown = panMethod.bind(this, (amount, animationTime) => (
                this.pan(null, viewBox.y + amount, animationTime)
            ));

            this.pan = (x, y, animationTime) => (
                this.setViewBox(x, y, null, null, animationTime, () => {
                    this.options.pan.callback(this.getViewBox());
                })
            );
        }

        // Zoom methods
        zoom: {
            function zoomMethod(callback, focalPoint, amount, animationTime) {
                if (!this.options.zoom) {
                    return this;
                }

                if (!amount && amount !== 0) {
                    amount = this.options.zoom.factor
                    if (!amount) {
                        return this;
                    }
                }

                return callback(focalPoint, amount, animationTime);
            };

            this.zoomIn = zoomMethod.bind(this, (focalPoint, amount, animationTime) => (
                this.zoomOut(focalPoint, -amount, animationTime)
            ));

            this.zoomOut = zoomMethod.bind(this, (focalPoint, amount, animationTime) => {
                let newHeight, newWidth;
                if (amount < 0) {
                    newWidth = viewBox.width / (1 - amount);
                    newHeight = viewBox.height / (1 - amount);
                } else {
                    newWidth = viewBox.width * (1 + amount);
                    newHeight = viewBox.height * (1 + amount);
                }

                //Validate zoom limits
                const minWidthAfterZoom = this.options.initialViewBox.width / this.options.zoom.maxZoom;
                const maxWidthAfterZoom = this.options.initialViewBox.width / this.options.zoom.minZoom;
                if (newWidth < minWidthAfterZoom) {
                    newHeight *= minWidthAfterZoom / newWidth;
                    newWidth = minWidthAfterZoom;
                } else if (newWidth > maxWidthAfterZoom) {
                    newHeight *= maxWidthAfterZoom / newWidth;
                    newWidth = maxWidthAfterZoom;
                }

                const minHeightAfterZoom = this.options.initialViewBox.height / this.options.zoom.maxZoom;
                const maxHeightAfterZoom = this.options.initialViewBox.height / this.options.zoom.minZoom;
                if (newHeight < minHeightAfterZoom) {
                    newWidth *= minHeightAfterZoom / newHeight;
                    newHeight = minHeightAfterZoom;
                } else if (newHeight > maxHeightAfterZoom) {
                    newWidth *= maxHeightAfterZoom / newHeight;
                    newHeight = maxHeightAfterZoom;
                }

                // Calculate origin based on the focal point constant
                let origin;
                if (!focalPoint) {
                    origin = {
                        x: viewBox.x + (viewBox.width - newWidth) / 2,
                        y: viewBox.y + (viewBox.height - newHeight) / 2
                    };
                } else {
                    origin = {
                        x: focalPoint.x + (newWidth / viewBox.width) * (viewBox.x - focalPoint.x),
                        y: focalPoint.y + (newHeight / viewBox.height) * (viewBox.y - focalPoint.y),
                    };
                }

                return this.setViewBox(origin.x, origin.y, newWidth, newHeight, animationTime, () => {
                    this.options.zoom.callback(this.options.initialViewBox.width / newWidth, this.getViewBox());
                });
            });
        }

        this.destroy = Function.prototype;

        // Fill in default options
        extend(this.options, extend(true, {}, defaultOptions, options));

        // Set initial viewbox
        this.reset(0);
    }

    validateLimits(viewBox) {
        const limits = this.options.limits;
        const initialViewBox = this.options.initialViewBox;

        if (viewBox.width <= initialViewBox.width) {
            viewBox.x = Math.min(Math.max(viewBox.x, limits.minX), limits.maxX + (initialViewBox.width - viewBox.width));
        } else {
            viewBox.x = Math.min(Math.max(viewBox.x, limits.minX + (initialViewBox.width - viewBox.width)), limits.maxX);
        }

        if (viewBox.height <= initialViewBox.height) {
            viewBox.y = Math.min(Math.max(viewBox.y, limits.minY), limits.maxY + (initialViewBox.height - viewBox.height));
        } else {
            viewBox.y = Math.min(Math.max(viewBox.y, limits.minY + (initialViewBox.height - viewBox.height)), limits.maxY);
        }
    }

    reset(animationTime, callback) {
        return this.clone(this.options.initialViewBox, animationTime, callback);
    }

    clone(viewBox, animationTime, callback) {
        return this.setViewBox(viewBox.x, viewBox.y, viewBox.width, viewBox.height, animationTime, callback);
    }

    getCenter() {
        const viewBox = this.getViewBox();
        return {
            x: viewBox.x + viewBox.width / 2,
            y: viewBox.y + viewBox.height / 2
        };
    }

    setCenter(x, y, animationTime, callback) {
        var viewBox = this.getViewBox();
        return this.setViewBox(x - viewBox.width / 2, y - viewBox.height / 2, viewBox.width, viewBox.height, animationTime, callback);
    }

    _setupEvents() {
        const svg = this.svg;
        const handlers = {
            mousewheel: function(event) {
                event.preventDefault();
                event.stopPropagation();

                event = event || event.originalEvent;
                const detail = event.detail || event.deltaX || event.deltaY || event.deltaZ;
                const delta = parseInt(-detail || event.wheelDelta);

                if (!delta || !this.options.zoom || !this.options.zoom.events.mouseWheel) {
                    return;
                }

                const mouse = getViewBoxCoordinatesFromEvent(svg, event);
                if (delta > 0) {
                    this.zoomIn(mouse, null, 0);
                } else {
                    this.zoomOut(mouse, null, 0);
                }
            },
            dblclick: function(event) {
                if (!this.options.zoom || !this.options.zoom.events.doubleClick) {
                    return;
                }

                this.zoomIn(getViewBoxCoordinatesFromEvent(svg, event));
            }
        };

        touchEvents: {
            let dragStarted = false;
            let scaleStarted = false;
            let preventClick = false;
            let pinchDistance = 0;

            handlers.click = function(event) {
                if (preventClick) {
                    preventClick = false;
                    event.preventDefault();
                }
            };

            handlers.pinchAndDrag = function(event) {
                if (!this.options.pan.events.drag || (event.type === "mousedown" && event.which !== this.options.pan.events.dragMouseButton) || dragStarted || scaleStarted) {
                    return;
                }

                preventClick = false;
                const domBody = window.document.body;
                const initialViewBox = extend({}, this.getViewBox());

                const oldCursor = this.options.eventMagnet.style.cursor;
                if (this.options.pan.events.dragCursor !== null) {
                    this.options.eventMagnet.style.cursor = this.options.pan.events.dragCursor;
                }

                if (event.type === "touchstart" && isDoubleTouch(event)) {
                    scaleStarted = true;
                    pinchDistance = touchDistance(event);
                } else {
                    dragStarted = true;
                }

                const mouseMoveCallback = event2 => {
                    const isTouch = /touch/i.test(event.type);
                    const checkDoubleTouch = isTouch && isDoubleTouch(event2);

                    if (scaleStarted && !checkDoubleTouch) {
                        return;
                    }

                    event2.preventDefault();

                    if (!scaleStarted && checkDoubleTouch) {
                        scaleStarted = true;
                        dragStarted = false;
                        pinchDistance = touchDistance(event2);
                    }

                    if (Math.sqrt(Math.pow(event.pageX - event2.pageX, 2) + Math.pow(event.pageY - event2.pageY, 2)) > 25) {
                        preventClick = true;
                    }

                    if (dragStarted) {
                        const initialMousePosition = getViewBoxCoordinatesFromEvent(svg, event);
                        const currentMousePosition = getViewBoxCoordinatesFromEvent(svg, event2);
                        this.pan(initialViewBox.x + (initialMousePosition.x - currentMousePosition.x), initialViewBox.y + (initialMousePosition.y - currentMousePosition.y), 0);
                    } else if (scaleStarted) {
                        const newPinchDistance = touchDistance(event2);
                        if (newPinchDistance === pinchDistance) {
                            return;
                        }

                        const mouse = touchCenter(svg, event2);
                        if (pinchDistance > newPinchDistance) {
                            this.zoomOut(mouse, (pinchDistance - newPinchDistance) / newPinchDistance, 0);
                        } else {
                            this.zoomOut(mouse, (pinchDistance - newPinchDistance) / pinchDistance, 0);
                        }
                        pinchDistance = newPinchDistance;
                    }
                };

                const mouseUpCallback = event2 => {
                    if (
                        (event2.type === "mouseout" && event2.target !== event2.currentTarget) ||
                        (event2.type === "mouseup" && event2.which !== this.options.pan.events.dragMouseButton)
                    ) {
                        return;
                    }

                    domBody.removeEventListener("mousemove", mouseMoveCallback, {
                        passive: false,
                        capture: true
                    });
                    domBody.removeEventListener("touchmove", mouseMoveCallback, {
                        passive: false,
                        capture: true
                    });
                    domBody.removeEventListener("mouseup", mouseUpCallback, {
                        passive: false,
                        capture: true
                    });
                    domBody.removeEventListener("touchend", mouseUpCallback, {
                        passive: false,
                        capture: true
                    });
                    domBody.removeEventListener("touchcancel", mouseUpCallback, {
                        passive: false,
                        capture: true
                    });
                    domBody.removeEventListener("mouseout", mouseUpCallback, {
                        passive: false,
                        capture: true
                    });

                    if (this.options.pan.events.dragCursor !== null) {
                        this.options.eventMagnet.style.cursor = oldCursor;
                    }

                    dragStarted = false;
                    scaleStarted = false;
                    pinchDistance = 0;
                };

                domBody.addEventListener("mousemove", mouseMoveCallback, {
                    passive: false,
                    capture: true
                });
                domBody.addEventListener("touchmove", mouseMoveCallback, {
                    passive: false,
                    capture: true
                });
                domBody.addEventListener("mouseup", mouseUpCallback, {
                    passive: false,
                    capture: true
                });
                domBody.addEventListener("touchend", mouseUpCallback, {
                    passive: false,
                    capture: true
                });
                domBody.addEventListener("touchcancel", mouseUpCallback, {
                    passive: false,
                    capture: true
                });
                domBody.addEventListener("mouseout", mouseUpCallback, {
                    passive: false,
                    capture: true
                });
            }
        }

        Object.keys(handlers).forEach(handler => {
            handlers[handler] = handlers[handler].bind(this);
        });

        this.options.eventMagnet.addEventListener("DOMMouseScroll", handlers.mousewheel);
        this.options.eventMagnet.addEventListener("wheel", handlers.mousewheel);

        this.options.eventMagnet.addEventListener("dblclick", handlers.dblclick);
        this.options.eventMagnet.addEventListener("click", handlers.click, {
            capture: true
        });

        this.options.eventMagnet.addEventListener("mousedown", handlers.pinchAndDrag, {
            passive: false,
            capture: true
        });
        this.options.eventMagnet.addEventListener("touchstart", handlers.pinchAndDrag, {
            passive: false,
            capture: true
        });

        this.destroy = function() {
            this.options.eventMagnet.removeEventListener("DOMMouseScroll", handlers.mousewheel);
            this.options.eventMagnet.removeEventListener("wheel", handlers.mousewheel);

            this.options.eventMagnet.removeEventListener("dblclick", handlers.dblclick);
            this.options.eventMagnet.removeEventListener("click", handlers.click, {
                capture: true
            });

            this.options.eventMagnet.removeEventListener("mousedown", handlers.pinchAndDrag, {
                passive: false,
                capture: true
            });
            this.options.eventMagnet.removeEventListener("touchstart", handlers.pinchAndDrag, {
                passive: false,
                capture: true
            });
        };
    }
}

export default SVGPanZoom;