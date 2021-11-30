import {
  getVerovioContainerSize
} from './resizer.js'
import * as speed from './speed';
import * as utils from './utils';
import * as dutils from './dom-utils';
import * as att from './attribute-classes';


export default class Viewer {


  constructor(worker) {
    this.worker = worker;
    this.currentPage = 1;
    this.pageCount = 0;
    this.selectedElements = [];
    this.lastNoteId = '';
    this.notationNightMode = false;
    // this.tkOptions = this.vrvToolkit.getAvailableOptions();
    this.updateNotation = true; // whether or not notation gets re-rendered after text changes
    this.speedMode = false; // speed mode (just feeds on page to Verovio to reduce drawing time)
    this.parser = new DOMParser();
    this.xmlDoc;
    this.encodingHasChanged = true; // to recalculate DOM or pageLists
    this.pageList = []; // list of range arrays [row1, col1, row2, col2, i] in textBuffer coordinates
    this.scoreDefList = []; // list of xmlNodes, one for each change, referenced by 5th element of pageList
    this.meiHeadRange = [];
    this.whichBreaks = ['sb', 'pb'];
    this.toolTipTimeOutHandle = null; // handle for zoom tooltip hide timer
    this.vrvOptions;
  }

  // change options, load new data, render current page, add listeners, highlight
  updateAll(cm, options = {}, setCursorToPageBeginning = false) {
    // TODO txtEdr.setTabLength(3);
    // console.info('updateAll: tabLength: ' + txtEdr.getTabLength() + ', editor: ', txtEdr);
    // this.showLoadingMessage();
    this.setVerovioOptions(options);
    if (this.speedMode) {
      this.loadXml(cm);
      let mei = speed.getPageFromDom(this.xmlDoc, this.currentPage,
        this.whichBreaks);
      // console.info('updateAll(): ', mei);
      this.loadVerovioData(mei);
    } else {
      this.loadVerovioData(cm.getValue());
    }
    if (setCursorToPageBeginning) this.setCursorToPageBeginning(cm);
    this.addNotationEventListeners(cm);
    this.setNotationColors();
    this.updateHighlight(cm);
  }


// set Verovio options
  setVerovioOptions(newOptions = {}, loadData = true) {
    if (newOptions) this.vrvOptions = newOptions;
    this.vrvOptions.scale =
      parseInt(document.getElementById('verovio-zoom').value);

    let dimensions = getVerovioContainerSize();
    if (this.vrvOptions.breaks !== "none") {
      this.vrvOptions.pageWidth = Math.max(Math.round(
        dimensions.width * (100 / this.vrvOptions.scale)), 100);
      this.vrvOptions.pageHeight = Math.max(Math.round(
        dimensions.height * (100 / this.vrvOptions.scale)), 100);
    }
    // overwrite existing options if new ones are passed in
    // for (let key in newOptions) {
    //   this.vrvOptions[key] = newOptions[key];
    // }
    this.worker.postMessage({
      'cmd': 'setOptions',
      'msg': this.vrvOptions,
      'loadData': loadData // if handler should load data after loading options
    });
  }

  loadVerovioData(mei) {
    this.worker.postMessage({
      'cmd': 'loadData',
      'msg': `${mei}`
    });
  }

  showCurrentPage(page = this.currentPage) {
    console.info('showCurrentPage(): ' + page + ' of ' + this.pageCount);
    if (this.pageCount === 0) return; // no data loaded
    if (!this.isValidCurrentPage()) page = 1;
    this.worker.postMessage({
      'cmd': 'getPage',
      'msg': page
    });
    this.updatePageNumDisplay();
  }

  isValidCurrentPage() {
    return (this.currentPage > 0 && this.currentPage <= this.pageCount);
  }

  changeHighlightColor(color) {
    document.getElementById('customStyle').innerHTML =
      `.mei-friend #verovio-panel g.highlighted,
      .mei-friend #verovio-panel g.highlighted,
      .mei-friend #verovio-panel g.highlighted,
      .mei-friend #verovio-panel g.highlighted * {
        fill: ${color};
        color: ${color};
        stroke: ${color};
    }`;
  }

  // accepts number or string (first, last, forwards, backwards)
  changeCurrentPage(newPage) {
    let targetpage;
    if (Number.isInteger(newPage)) {
      targetpage = Math.abs(Math.round(newPage));
    } else {
      newPage = newPage.toLowerCase();
      if (newPage === 'first') {
        targetpage = 1;
      } else if (newPage === 'last') {
        targetpage = this.pageCount
      } else if (newPage === 'forwards') {
        if (this.currentPage < this.pageCount) {
          targetpage = this.currentPage + 1;
        }
      } else if (newPage === 'backwards') {
        if (this.currentPage > 1) {
          targetpage = this.currentPage - 1;
        }
      } else {
        return;
      }
    }
    if (targetpage > 0 && targetpage <= this.pageCount) {
      this.currentPage = targetpage;
      this.updatePageNumDisplay();
    }
  }

  updatePageNumDisplay() {
    const l = document.getElementById("pagination-label");
    if (l) l.innerHTML = `Page ${this.currentPage} of ${this.pageCount}`;
  }

  // set cursor to first note id in page, taking st/ly of id, if possible
  // TODO
  setCursorToPageBeginning(txtEdr) {
    let id = this.lastNoteId;
    let buffer = txtEdr.getBuffer();
    let stNo, lyNo;
    let rg;
    if (id == '') {
      id = document.querySelector('.note').getAttribute('id');
    } else {
      rg = utils.locateIdInBuffer(buffer, id);
      if (rg) {
        stNo = utils.getElementAttributeAbove(buffer, rg.start.row, 'staff')[0];
        lyNo = utils.getElementAttributeAbove(buffer, rg.start.row, 'layer')[0];
        let m = document.querySelector('.measure');
        console.info('setCursorToPgBg st/ly;m: ' + stNo + '/' + lyNo + '; ', m);
        if (m) {
          id = dutils.getFirstInMeasure(m, dutils.navElsSelector, stNo, lyNo);
        }
      }
    }
    rg = utils.locateIdInBuffer(buffer, id);
    if (rg) {
      txtEdr.setCursorBufferPosition([rg.start.row, rg.start.column]);
    }
    console.info('setCrsrToPgBeg(): lastNoteId: ' + this.lastNoteId +
      ', new id: ' + id);
    this.selectedElements[0] = id;
    this.lastNoteId = id;
    return id;
  }

  addNotationEventListeners(txtEdr) {
    let elements = $(`#${this.verovioPanel.id}`).find('g[id]');
    if (elements.length !== 0) {
      // TODO avoid jQuery: elements.addEventListener('mouseup', function)...
      elements.bind('mouseup', (el) => {
        this.handleClickOnNotation(el, txtEdr);
      });
    } else {
      setTimeout(() => {
        this.addNotationEventListeners(txtEdr);
      }, 50);
    }
  }

  handleClickOnNotation(e, txtEdr) {
    e.stopImmediatePropagation();
    console.info('click: ', e);
    let itemId = String(e.currentTarget.id);
    let el = document.querySelector('g#' + itemId);
    // TODO: remove jQuery...
    if (el.getAttribute('class') == 'note')
      console.info('CLICK note: x ', dutils.getX(el));
    else if (el.getAttribute('class') == 'chord')
      console.info('CLICK chord: x ', dutils.getX(el));
    let range;
    // take chord rather than note xml:id, when ALT is pressed
    chordId = utils.insideParent(itemId);
    if (e.altKey && chordId) itemId = chordId;
    // select tuplet when clicking on tupletNum
    if (e.currentTarget.getAttribute('class') == 'tupletNum')
      itemId = utils.insideParent(itemId, 'tuplet');

    if (((navigator.appVersion.indexOf("Mac") !== -1) && e.metaKey) || e.ctrlKey) {
      this.selectedElements.push(itemId);
      console.info('handleClickOnNotation() added: ' +
        this.selectedElements[this.selectedElements.length - 1] +
        ', size now: ' + this.selectedElements.length);
    } else {
      // set cursor position in buffer
      range = utils.locateIdInBuffer(txtEdr.getBuffer(), itemId);
      if (range) {
        txtEdr.setCursorBufferPosition([range.start.row, range.start.column]);
      }
      this.selectedElements = [];
      this.selectedElements.push(itemId);
      console.info('handleClickOnNotation() newly created: ' +
        this.selectedElements[this.selectedElements.length - 1] +
        ', size now: ' + this.selectedElements.length);
    }
    this.updateHighlight(txtEdr);
    this.setFocusToVerovioPane();
    // set lastNoteId to @startid or @staff of control element
    let startid = utils.getAttributeById(txtEdr.getBuffer(), itemId);
    if (startid && startid.startsWith('#')) startid = startid.split('#')[1];
    // console.info('startid: ', startid);
    // if (!startid) { // work around for tstamp/staff
    // TODO: find note corresponding to @staff/@tstamp
    // startid = utils.getAttributeById(txtEdr.getBuffer(), itemId, attribute = 'tstamp');
    // console.info('staff: ', startid);
    // }
    if (startid) this.lastNoteId = startid;
    else this.lastNoteId = itemId;

    // let elementName = 'undefined'; // retrieve element name
    // if (elementString != '') {
    //   elementName = elementString.match(/[\w.-]+/);
    // }
    // console.info('elementName: "' + elementName + '"');
    // if (elementName == 'undefined') return;

    // str = 'handleClickOnNotation() selected: ';
    // for (i of this.selectedElements) console.info(str += i + ', ');
    // console.info(str);
  }

  // highlight currently selected elements
  updateHighlight(cm) {
    // clear existing highlighted classes
    let highlighted = document.querySelectorAll('g.highlighted');
    // console.info('updateHlt: highlighted: ', highlighted);
    if (highlighted) highlighted.forEach(e => {
      e.classList.remove('highlighted');
    })
    let ids = [];
    if (this.selectedElements.length > 0)
      this.selectedElements.forEach(item => ids.push(item));
    else ids.push(utils.getElementIdAtCursor(cm.getDoc()));
    // console.info('updateHlt ids: ', ids);
    for (id of ids) {
      if (id) {
        let el = document.querySelector('g#' + id)
        // console.info('updateHlt el: ', el);
        if (el) el.classList.add('highlighted');
      }
    }
  }


// TODO: get rid of jquery
  setNotationColors() {
    if (this.notationNightMode) {
      $('g').addClass('inverted');
      $('#verovio-panel').addClass('inverted');
    } else {
      $('g.inverted').removeClass('inverted');
      $('#verovio-panel').removeClass('inverted');
    }
  }

  swapNotationColors() {
    if (this.notationNightMode) {
      this.notationNightMode = false;
    } else {
      this.notationNightMode = true;
    }
    console.info('swapNotationColors: ' + this.notationNightMode);
    this.setNotationColors();
  }

  // zoom(item, delta) {
  //   if (delta <= 30) // delta only up to 30% difference
  //     this.zoomCtrl.value = parseInt(this.zoomCtrl.value) + delta;
  //   else // otherwise take it as the scaling value
  //     this.zoomCtrl.value = delta;
  //   this.updateLayout(item);
  //   this.updateZoomSliderTooltip();
  //   this.setFocusToVerovioPane();
  // }

}