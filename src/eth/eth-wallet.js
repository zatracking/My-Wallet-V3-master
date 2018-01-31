const WebSocket = require('ws');
const EthHd = require('ethereumjs-wallet/hdkey');
const { construct } = require('ramda');
const { isPositiveNumber, asyncOnce, dedup } = require('../helpers');
const API = require('../api');
const EthTxBuilder = require('./eth-tx-builder');
const EthAccount = require('./eth-account');
const EthSocket = require('./eth-socket');
const EthWalletTx = require('./eth-wallet-tx');

const METADATA_TYPE_ETH = 5;
const DERIVATION_PATH = "m/44'/60'/0'/0";

class EthWallet {
  constructor (wallet, metadata) {
    this._wallet = wallet;
    this._metadata = metadata;
    this._hasSeen = false;
    this._defaultAccountIdx = 0;
    this._accounts = [];
    this._txNotes = {};
    this._latestBlock = null;
    this._lastTx = null;
    this.sync = asyncOnce(this.sync.bind(this), 250);
  }

  get wei () {
    return this.defaultAccount ? this.defaultAccount.wei : null;
  }

  get balance () {
    return this.defaultAccount ? this.defaultAccount.balance : null;
  }

  get hasSeen () {
    return this._hasSeen;
  }

  get defaultAccountIdx () {
    return this._defaultAccountIdx;
  }

  get defaultAccount () {
    return this.accounts[this.defaultAccountIdx];
  }

  get accounts () {
    return this._accounts;
  }

  get legacyAccount () {
    return this._legacyAccount;
  }

  get activeAccounts () {
    return this.accounts.filter(a => !a.archived);
  }

  get activeAccountsWithLegacy () {
    return this.legacyAccount
      ? this.activeAccounts.concat(this.legacyAccount)
      : this.activeAccounts;
  }

  get latestBlock () {
    return this._latestBlock;
  }

  get lastTx () {
    return this._lastTx;
  }

  get defaults () {
    return {
      GAS_PRICE: EthTxBuilder.GAS_PRICE,
      GAS_LIMIT: EthTxBuilder.GAS_LIMIT
    };
  }

  get txs () {
    let accounts = this.activeAccountsWithLegacy;
    return dedup(accounts.map(a => a.txs), 'hash').sort(EthWalletTx.txTimeSort);
  }

  getApproximateBalance () {
    if (!this.defaultAccount && !this.legacyAccount) return null;
    let balance = 0;
    if (this.defaultAccount) {
      balance += parseFloat(this.defaultAccount.getApproximateBalance());
    }
    if (this.legacyAccount) {
      balance += parseFloat(this.legacyAccount.getApproximateBalance());
    }
    return balance.toFixed(8);
  }

  getAccount (index) {
    let account = this.accounts[index];
    if (!account) throw new Error(`Account ${index} does not exist`);
    return account;
  }

  setAccountLabel (index, label) {
    this.getAccount(index).label = label;
    this.sync();
  }

  archiveAccount (account) {
    if (account === this.defaultAccount) {
      throw new Error('Cannot archive default account');
    }
    account.archived = true;
    this.sync();
  }

  unarchiveAccount (account) {
    account.archived = false;
    this._socket.subscribeToAccount(this, account);
    this.sync();
  }

  createAccount (label, secPass) {
    let accountNode = this.deriveChild(this.accounts.length, secPass);
    let account = EthAccount.fromWallet(accountNode.getWallet());
    account.label = label || EthAccount.defaultLabel(this.accounts.length);
    account.markAsCorrect();
    this._accounts.push(account);
    this._socket.subscribeToAccount(this, account, this.legacyAccount);
    return this.sync();
  }

  getTxNote (hash) {
    return this._txNotes[hash] || null;
  }

  setTxNote (hash, note) {
    if (note === null || note === '') {
      delete this._txNotes[hash];
    } else if (typeof note !== 'string') {
      throw new Error('setTxNote note must be a string or null');
    } else {
      this._txNotes[hash] = note;
    }
    this.updateTxs();
    this.sync();
  }

  setLastTx (tx) {
    this._lastTx = tx;
    this.sync();
  }

  setHasSeen (hasSeen) {
    this._hasSeen = hasSeen;
    this.sync();
  }

  setDefaultAccountIndex (i) {
    if (!isPositiveNumber(i)) {
      throw new Error('Account index must be a number >= 0');
    } else if (i >= this.accounts.length) {
      throw new Error('Account index out of bounds');
    } else if (this._defaultAccountIdx === i) {
      return;
    } else {
      this._defaultAccountIdx = i;
      this.sync();
    }
  }

  fetch () {
    return this._metadata.fetch().then((data) => {
      if (data) {
        let constructAccount = construct(EthAccount);
        let { ethereum } = data;
        this._hasSeen = ethereum.has_seen;
        this._defaultAccountIdx = ethereum.default_account_idx;
        this._accounts = ethereum.accounts.map(constructAccount);
        this._txNotes = ethereum.tx_notes || {};
        this._lastTx = ethereum.last_tx;
        if (ethereum.legacy_account) {
          this._legacyAccount = constructAccount(ethereum.legacy_account);
        }
      }
    });
  }

  sync () {
    let data = { ethereum: this };
    return this._metadata.update(data);
  }

  toJSON () {
    return {
      has_seen: this._hasSeen,
      default_account_idx: this._defaultAccountIdx,
      accounts: this._accounts,
      legacy_account: this._legacyAccount,
      tx_notes: this._txNotes,
      last_tx: this._lastTx
    };
  }

  fetchHistory () {
    return Promise.all([this.fetchBalance(), this.fetchTransactions()])
      .then(() => this.getLatestBlock());
  }

  fetchBalance () {
    let accounts = this.activeAccountsWithLegacy;
    if (!accounts.length) return Promise.resolve();
    let addresses = accounts.map(a => a.address);
    return fetch(`${API.API_ROOT_URL}eth/account/${addresses.join()}/balance`)
      .then(r => r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(data => accounts.forEach(a => a.setData(data[a.address])));
  }

  fetchTransactions () {
    let accounts = this.activeAccountsWithLegacy;
    if (!accounts.length) return Promise.resolve();
    let addresses = accounts.map(a => a.address);
    return fetch(`${API.API_ROOT_URL}eth/account/${addresses.join()}`)
      .then(r => r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(data => {
        accounts.forEach(a => a.setTransactions(data[a.address]));
        this.updateTxs();
      });
  }

  fetchFees () {
    return EthTxBuilder.fetchFees();
  }

  isContractAddress (address) {
    return fetch(`${API.API_ROOT_URL}eth/account/${address}/isContract`)
      .then(r => r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(({ contract }) => contract);
  }

  getLatestBlock () {
    return fetch(`${API.API_ROOT_URL}eth/latestblock`)
      .then(r => r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(block => this.setLatestBlock(block.number));
  }

  setLatestBlock (blockNumber) {
    this._latestBlock = blockNumber;
    this.updateTxs();
  }

  connect (wsUrl) {
    if (this._socket) return;
    this._socket = new EthSocket(wsUrl, WebSocket);
    this._socket.on('open', () => this.setSocketHandlers());
    this._socket.on('close', () => this.setSocketHandlers());
  }

  setSocketHandlers () {
    this._socket.subscribeToBlocks(this);
    this.activeAccounts.forEach(a => this._socket.subscribeToAccount(this, a, this.legacyAccount));
  }

  updateTxs () {
    this.activeAccountsWithLegacy.forEach(a => a.updateTxs(this));
  }

  getPrivateKeyForAccount (account, secPass) {
    let index = this.accounts.indexOf(account);
    let wallet = this.deriveChild(index, secPass).getWallet();
    let privateKey = wallet.getPrivateKey();
    if (!account.isCorrectPrivateKey(privateKey)) {
      throw new Error('Failed to derive correct private key');
    }
    return privateKey;
  }

  deriveChild (index, secPass) {
    let w = this._wallet;
    let cipher;
    if (w.isDoubleEncrypted) {
      if (!secPass) throw new Error('Second password required to derive ethereum wallet');
      else cipher = w.createCipher(secPass);
    }
    let masterHdNode = w.hdwallet.getMasterHDNode(cipher);
    let accountNode = masterHdNode
      .deriveHardened(44)
      .deriveHardened(60)
      .deriveHardened(0)
      .derive(0)
      .derive(index);
    return EthHd.fromExtendedKey(accountNode.toBase58());
  }

  /* start legacy */

  getPrivateKeyForLegacyAccount (secPass) {
    let account = this._legacyAccount;
    if (!account) {
      throw new Error('Wallet does not contain a beta account');
    }
    let wallet = this.deriveChildLegacy(0, secPass).getWallet();
    let privateKey = wallet.getPrivateKey();
    if (!account.isCorrectPrivateKey(privateKey)) {
      throw new Error('Failed to derive correct private key');
    }
    return privateKey;
  }

  deriveChildLegacy (index, secPass) {
    let w = this._wallet;
    if (w.isDoubleEncrypted && !secPass) {
      throw new Error('Second password required to derive ethereum wallet');
    }
    let getSeedHex = w.isDoubleEncrypted ? w.createCipher(secPass, 'dec') : x => x;
    let seed = getSeedHex(w.hdwallet.seedHex);
    return EthHd.fromMasterSeed(seed).derivePath(DERIVATION_PATH).deriveChild(index);
  }

  needsTransitionFromLegacy () {
    let shouldSweepAccount = (account) => (
      account.fetchBalance()
        .then(() => account.getAvailableBalance())
        .then(({ amount }) => amount > 0)
    );

    if (this.defaultAccount && !this.defaultAccount.isCorrect) {
      /*
        If user has an eth account and the account is not marked as
        correct, check if they should sweep.
      */
      return shouldSweepAccount(this.defaultAccount);
    } else if (this.legacyAccount) {
      /*
        If user has a legacy eth account saved, we should still check
        if the account needs to be swept in case funds were received after
        the previous transition.
      */
      return shouldSweepAccount(this.legacyAccount);
    } else {
      /*
        Default account is up to date and there is no legacy account,
        do nothing.
      */
      return Promise.resolve(false);
    }
  }

  transitionFromLegacy () {
    if (this.defaultAccount && !this.defaultAccount.isCorrect) {
      this._legacyAccount = this.getAccount(0);
      this._accounts = [];
      return this.sync();
    } else {
      return Promise.resolve();
    }
  }

  sweepLegacyAccount (secPass, { gasPrice = EthTxBuilder.GAS_PRICE, gasLimit = EthTxBuilder.GAS_LIMIT } = {}) {
    if (!this.legacyAccount) {
      return Promise.reject(new Error('Must transition from Beta account first'));
    }

    let defaultAccountP = this.defaultAccount == null
      ? Promise.resolve().then(() => this.createAccount(void 0, secPass))
      : Promise.resolve();

    return defaultAccountP
      .then(() => this.legacyAccount.getAvailableBalance())
      .then(({ amount }) => {
        if (amount > 0) {
          let payment = this.legacyAccount.createPayment();
          let privateKey = this.getPrivateKeyForLegacyAccount(secPass);
          payment.setGasPrice(gasPrice);
          payment.setGasLimit(gasLimit);
          payment.setTo(this.defaultAccount.address);
          payment.setSweep();
          payment.sign(privateKey);
          return payment.publish();
        } else {
          throw new Error('No funds in account to sweep');
        }
      });
  }

  __transitionToLegacy (secPass) {
    delete this._legacyAccount;
    let accountNode = this.deriveChildLegacy(0, secPass);
    let account = EthAccount.fromWallet(accountNode.getWallet());
    account.label = EthAccount.defaultLabel(0);
    this._accounts = [account];
    this._socket.subscribeToAccount(this, account);
    return this.sync();
  }

  /* end legacy */

  static fromBlockchainWallet (wallet) {
    let metadata = wallet.metadata(METADATA_TYPE_ETH);
    return new EthWallet(wallet, metadata);
  }
}

module.exports = EthWallet;
