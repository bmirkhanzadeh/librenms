var Emitter = require('emitter-component');
var Hammer = require('../module/hammer');
var moment = require('../module/moment');
var util = require('../util');
var DataSet = require('../DataSet');
var DataView = require('../DataView');
var Range = require('./Range');
var Core = require('./Core');
var TimeAxis = require('./component/TimeAxis');
var CurrentTime = require('./component/CurrentTime');
var CustomTime = require('./component/CustomTime');
var ItemSet = require('./component/ItemSet');

var Configurator = require('../shared/Configurator');
var Validator = require('../shared/Validator').default;
var printStyle = require('../shared/Validator').printStyle;
var allOptions = require('./optionsTimeline').allOptions;
var configureOptions = require('./optionsTimeline').configureOptions;

/**
 * Create a timeline visualization
 * @param {HTMLElement} container
 * @param {vis.DataSet | vis.DataView | Array} [items]
 * @param {vis.DataSet | vis.DataView | Array} [groups]
 * @param {Object} [options]  See Timeline.setOptions for the available options.
 * @constructor
 * @extends Core
 */
function Timeline (container, items, groups, options) {
  if (!(this instanceof Timeline)) {
    throw new SyntaxError('Constructor must be called with the new operator');
  }

  // if the third element is options, the forth is groups (optionally);
  if (!(Array.isArray(groups) || groups instanceof DataSet || groups instanceof DataView) && groups instanceof Object) {
    var forthArgument = options;
    options = groups;
    groups = forthArgument;
  }

  var me = this;
  this.defaultOptions = {
    start: null,
    end:   null,

    autoResize: true,

    orientation: {
      axis: 'bottom',   // axis orientation: 'bottom', 'top', or 'both'
      item: 'bottom'    // not relevant
    },

    moment: moment,

    width: null,
    height: null,
    maxHeight: null,
    minHeight: null
  };
  this.options = util.deepExtend({}, this.defaultOptions);

  // Create the DOM, props, and emitter
  this._create(container);

  // all components listed here will be repainted automatically
  this.components = [];

  this.body = {
    dom: this.dom,
    domProps: this.props,
    emitter: {
      on: this.on.bind(this),
      off: this.off.bind(this),
      emit: this.emit.bind(this)
    },
    hiddenDates: [],
    util: {
      getScale: function () {
        return me.timeAxis.step.scale;
      },
      getStep: function () {
        return me.timeAxis.step.step;
      },

      toScreen: me._toScreen.bind(me),
      toGlobalScreen: me._toGlobalScreen.bind(me), // this refers to the root.width
      toTime: me._toTime.bind(me),
      toGlobalTime : me._toGlobalTime.bind(me)
    }
  };

  // range
  this.range = new Range(this.body);
  this.components.push(this.range);
  this.body.range = this.range;

  // time axis
  this.timeAxis = new TimeAxis(this.body);
  this.timeAxis2 = null; // used in case of orientation option 'both'
  this.components.push(this.timeAxis);

  // current time bar
  this.currentTime = new CurrentTime(this.body);
  this.components.push(this.currentTime);

  // item set
  this.itemSet = new ItemSet(this.body);
  this.components.push(this.itemSet);

  this.itemsData = null;      // DataSet
  this.groupsData = null;     // DataSet

  this.on('tap', function (event) {
    me.emit('click', me.getEventProperties(event))
  });
  this.on('doubletap', function (event) {
    me.emit('doubleClick', me.getEventProperties(event))
  });
  this.dom.root.oncontextmenu = function (event) {
    me.emit('contextmenu', me.getEventProperties(event))
  };

  // apply options
  if (options) {
    this.setOptions(options);
  }

  // IMPORTANT: THIS HAPPENS BEFORE SET ITEMS!
  if (groups) {
    this.setGroups(groups);
  }

  // create itemset
  if (items) {
    this.setItems(items);
  }
  else {
    this._redraw();
  }
}

// Extend the functionality from Core
Timeline.prototype = new Core();

/**
 * Load a configurator
 * @return {Object}
 * @private
 */
Timeline.prototype._createConfigurator = function () {
  return new Configurator(this, this.dom.container, configureOptions);
};

/**
 * Force a redraw. The size of all items will be recalculated.
 * Can be useful to manually redraw when option autoResize=false and the window
 * has been resized, or when the items CSS has been changed.
 */
Timeline.prototype.redraw = function() {
  this.itemSet && this.itemSet.markDirty({refreshItems: true});
  this._redraw();
};

Timeline.prototype.setOptions = function (options) {
  // validate options
  let errorFound = Validator.validate(options, allOptions);
  if (errorFound === true) {
    console.log('%cErrors have been found in the supplied options object.', printStyle);
  }

  Core.prototype.setOptions.call(this, options);

  if ('type' in options) {
    if (options.type !== this.options.type) {
      this.options.type = options.type;

      // force recreation of all items
      var itemsData = this.itemsData;
      if (itemsData) {
        var selection = this.getSelection();
        this.setItems(null);          // remove all
        this.setItems(itemsData);     // add all
        this.setSelection(selection); // restore selection
      }
    }
  }
};

/**
 * Set items
 * @param {vis.DataSet | Array | null} items
 */
Timeline.prototype.setItems = function(items) {
  var initialLoad = (this.itemsData == null);

  // convert to type DataSet when needed
  var newDataSet;
  if (!items) {
    newDataSet = null;
  }
  else if (items instanceof DataSet || items instanceof DataView) {
    newDataSet = items;
  }
  else {
    // turn an array into a dataset
    newDataSet = new DataSet(items, {
      type: {
        start: 'Date',
        end: 'Date'
      }
    });
  }

  // set items
  this.itemsData = newDataSet;
  this.itemSet && this.itemSet.setItems(newDataSet);

  if (initialLoad) {
    if (this.options.start != undefined || this.options.end != undefined) {
      if (this.options.start == undefined || this.options.end == undefined) {
        var range = this.getItemRange();
      }

      var start = this.options.start != undefined ? this.options.start : range.min;
      var end   = this.options.end != undefined   ? this.options.end   : range.max;

      this.setWindow(start, end, {animation: false});
    }
    else {
      this.fit({animation: false});
    }
  }
};

/**
 * Set groups
 * @param {vis.DataSet | Array} groups
 */
Timeline.prototype.setGroups = function(groups) {
  // convert to type DataSet when needed
  var newDataSet;
  if (!groups) {
    newDataSet = null;
  }
  else if (groups instanceof DataSet || groups instanceof DataView) {
    newDataSet = groups;
  }
  else {
    // turn an array into a dataset
    newDataSet = new DataSet(groups);
  }

  this.groupsData = newDataSet;
  this.itemSet.setGroups(newDataSet);
};

/**
 * Set both items and groups in one go
 * @param {{items: Array | vis.DataSet, groups: Array | vis.DataSet}} data
 */
Timeline.prototype.setData = function (data) {
  if (data && data.groups) {
    this.setGroups(data.groups);
  }

  if (data && data.items) {
    this.setItems(data.items);
  }
};

/**
 * Set selected items by their id. Replaces the current selection
 * Unknown id's are silently ignored.
 * @param {string[] | string} [ids]  An array with zero or more id's of the items to be
 *                                selected. If ids is an empty array, all items will be
 *                                unselected.
 * @param {Object} [options]      Available options:
 *                                `focus: boolean`
 *                                    If true, focus will be set to the selected item(s)
 *                                `animation: boolean | {duration: number, easingFunction: string}`
 *                                    If true (default), the range is animated
 *                                    smoothly to the new window. An object can be
 *                                    provided to specify duration and easing function.
 *                                    Default duration is 500 ms, and default easing
 *                                    function is 'easeInOutQuad'.
 *                                    Only applicable when option focus is true.
 */
Timeline.prototype.setSelection = function(ids, options) {
  this.itemSet && this.itemSet.setSelection(ids);

  if (options && options.focus) {
    this.focus(ids, options);
  }
};

/**
 * Get the selected items by their id
 * @return {Array} ids  The ids of the selected items
 */
Timeline.prototype.getSelection = function() {
  return this.itemSet && this.itemSet.getSelection() || [];
};

/**
 * Adjust the visible window such that the selected item (or multiple items)
 * are centered on screen.
 * @param {String | String[]} id     An item id or array with item ids
 * @param {Object} [options]      Available options:
 *                                `animation: boolean | {duration: number, easingFunction: string}`
 *                                    If true (default), the range is animated
 *                                    smoothly to the new window. An object can be
 *                                    provided to specify duration and easing function.
 *                                    Default duration is 500 ms, and default easing
 *                                    function is 'easeInOutQuad'.
 */
Timeline.prototype.focus = function(id, options) {
  if (!this.itemsData || id == undefined) return;

  var ids = Array.isArray(id) ? id : [id];

  // get the specified item(s)
  var itemsData = this.itemsData.getDataSet().get(ids, {
    type: {
      start: 'Date',
      end: 'Date'
    }
  });

  // calculate minimum start and maximum end of specified items
  var start = null;
  var end = null;
  itemsData.forEach(function (itemData) {
    var s = itemData.start.valueOf();
    var e = 'end' in itemData ? itemData.end.valueOf() : itemData.start.valueOf();

    if (start === null || s < start) {
      start = s;
    }

    if (end === null || e > end) {
      end = e;
    }
  });

  if (start !== null && end !== null) {
    // calculate the new middle and interval for the window
    var middle = (start + end) / 2;
    var interval = Math.max((this.range.end - this.range.start), (end - start) * 1.1);

    var animation = (options && options.animation !== undefined) ? options.animation : true;
    this.range.setRange(middle - interval / 2, middle + interval / 2, animation);
  }
};

/**
 * Set Timeline window such that it fits all items
 * @param {Object} [options]  Available options:
 *                                `animation: boolean | {duration: number, easingFunction: string}`
 *                                    If true (default), the range is animated
 *                                    smoothly to the new window. An object can be
 *                                    provided to specify duration and easing function.
 *                                    Default duration is 500 ms, and default easing
 *                                    function is 'easeInOutQuad'.
 */
Timeline.prototype.fit = function (options) {
  var animation = (options && options.animation !== undefined) ? options.animation : true;
  var range = this.getItemRange();
  this.range.setRange(range.min, range.max, animation);
};

/**
 * Determine the range of the items, taking into account their actual width
 * and a margin of 10 pixels on both sides.
 * @return {{min: Date | null, max: Date | null}}
 */
Timeline.prototype.getItemRange = function () {
  // get a rough approximation for the range based on the items start and end dates
  var range = this.getDataRange();
  var min = range.min;
  var max = range.max;
  var minItem = null;
  var maxItem = null;

  if (min != null && max != null) {
    var interval = (max - min); // ms
    if (interval <= 0) {
      interval = 10;
    }
    var factor = interval / this.props.center.width;

    function getStart(item) {
      return util.convert(item.data.start, 'Date').valueOf()
    }

    function getEnd(item) {
      var end = item.data.end != undefined ? item.data.end : item.data.start;
      return util.convert(end, 'Date').valueOf();
    }

    // calculate the date of the left side and right side of the items given
    util.forEach(this.itemSet.items, function (item) {
      item.show();

      var start = getStart(item);
      var end = getEnd(item);

      var left  = new Date(start - (item.getWidthLeft() + 10) * factor);
      var right = new Date(end   + (item.getWidthRight() + 10) * factor);

      if (left < min) {
        min = left;
        minItem = item;
      }
      if (right > max) {
        max = right;
        maxItem = item;
      }
    }.bind(this));

    if (minItem && maxItem) {
      var lhs = minItem.getWidthLeft() + 10;
      var rhs = maxItem.getWidthRight() + 10;
      var delta = this.props.center.width - lhs - rhs;  // px

      if (delta > 0) {
        min = getStart(minItem) - lhs * interval / delta; // ms
        max = getEnd(maxItem)   + rhs * interval / delta; // ms
      }
    }
  }

  return {
    min: min != null ? new Date(min) : null,
    max: max != null ? new Date(max) : null
  }
};

/**
 * Calculate the data range of the items start and end dates
 * @returns {{min: Date | null, max: Date | null}}
 */
Timeline.prototype.getDataRange = function() {
  var min = null;
  var max = null;

  var dataset = this.itemsData && this.itemsData.getDataSet();
  if (dataset) {
    dataset.forEach(function (item) {
      var start = util.convert(item.start, 'Date').valueOf();
      var end   = util.convert(item.end != undefined ? item.end : item.start, 'Date').valueOf();
      if (min === null || start < min) {
        min = start;
      }
      if (max === null || end > max) {
        max = start;
      }
    });
  }

  return {
    min: min != null ? new Date(min) : null,
    max: max != null ? new Date(max) : null
  }
};

/**
 * Generate Timeline related information from an event
 * @param {Event} event
 * @return {Object} An object with related information, like on which area
 *                  The event happened, whether clicked on an item, etc.
 */
Timeline.prototype.getEventProperties = function (event) {
  var clientX = event.center ? event.center.x : event.clientX;
  var clientY = event.center ? event.center.y : event.clientY;
  var x = clientX - util.getAbsoluteLeft(this.dom.centerContainer);
  var y = clientY - util.getAbsoluteTop(this.dom.centerContainer);

  var item  = this.itemSet.itemFromTarget(event);
  var group = this.itemSet.groupFromTarget(event);
  var customTime = CustomTime.customTimeFromTarget(event);

  var snap = this.itemSet.options.snap || null;
  var scale = this.body.util.getScale();
  var step = this.body.util.getStep();
  var time = this._toTime(x);
  var snappedTime = snap ? snap(time, scale, step) : time;

  var element = util.getTarget(event);
  var what = null;
  if (item != null)                                                    {what = 'item';}
  else if (customTime != null)                                         {what = 'custom-time';}
  else if (util.hasParent(element, this.timeAxis.dom.foreground))      {what = 'axis';}
  else if (this.timeAxis2 && util.hasParent(element, this.timeAxis2.dom.foreground)) {what = 'axis';}
  else if (util.hasParent(element, this.itemSet.dom.labelSet))         {what = 'group-label';}
  else if (util.hasParent(element, this.currentTime.bar))              {what = 'current-time';}
  else if (util.hasParent(element, this.dom.center))                   {what = 'background';}

  return {
    event: event,
    item: item ? item.id : null,
    group: group ? group.groupId : null,
    what: what,
    pageX: event.srcEvent ? event.srcEvent.pageX : event.pageX,
    pageY: event.srcEvent ? event.srcEvent.pageY : event.pageY,
    x: x,
    y: y,
    time: time,
    snappedTime: snappedTime
  }
};

module.exports = Timeline;
