let proxyquire = require('proxyquireify')(require);
let MyWallet;
let HDWallet;
let BIP39;
let Bitcoin;

describe('HDWallet', () => {
  let wallet;
  let walletSecondPw;
  let object = {
    'seed_hex': '7e061ca8e579e5e70e9989ca40d342fe',
    'passphrase': '',
    'mnemonic_verified': false,
    'default_account_idx': 0,
    'accounts': [ {
      'label': 'My Bitcoin Wallet',
      'archived': false,
      'xpriv': 'xprv9yko4kDvhYSdUcqK5e8naLwtGE1Ca57mwJ6JMB8WxeYq8t1w3PpiZfGGvLN6N6GEwLF8XuHnp8HeNLrWWviAjXxb2BFEiLaW2UgukMZ3Zva',
      'xpub': 'xpub6Ck9UFkpXuzvh6unBffnwUtcpFqgyXqdJX1u9ZY8Wz5p1gM5aw8y7TakmcEWLA9rJkc59BJzn61p3qqKSaqFkSPMbbhGA9YDNmphj9SKBVJ',
      'address_labels': [],
      'cache': {
        'receiveAccount': 'xpub6FD59hfbH1UWQA9B8NP1C8bh3jc6i2tpM6b8f4Wi9gHWQttZbBBtEsDDZAiPsw7e3427SzvQsFu2sdubjbZHDQdqYXN6x3hTDCrG5bZFEhB',
        'changeAccount': 'xpub6FD59hfbH1UWRrY38bVLPPLPLxcA1XBqsQgB95AgsSWngxbwqPBMd5Z3of8PNicLwE9peQ9g4SeWWtBTzUKLwfjSioAg73RRh7dJ5rWYxM7'
      }
    } ]
  };

  let NodeInstance = node =>
    ({
      toBase58 () { return node; },
      derive (n) {
        return node + `/${n}`;
      }
    })
  ;

  Bitcoin = {
    HDNode: {
      fromSeedBuffer (masterHex, network) {
        if (masterHex === 'bad') {
          throw new Error('bad');
        }
        return new NodeInstance(masterHex.replace('-buffer', ''));
      },
      fromBase58 (base58) {
        return new NodeInstance(base58.replace('-base58', ''));
      }
    }
  };

  let hdAccountFactory = ({xpub, xpriv}, label) => {
    let state = {
      isEncrypted: false,
      isUnEncrypted: true
    };
    let persist = function () {
      this.isEncrypted = state.isEncrypted;
      this.isUnEncrypted = state.isUnEncrypted;
    };
    return {
      encrypt (cipher) {
        if (cipher && (cipher('test') === null)) {
          throw new Error('bad cipher');
        }
        state.isEncrypted = true;
        state.isUnEncrypted = false;
        this._temporal_xpriv = 'something';
        return {
          persist
        };
      },
      decrypt (cipher) {
        if (cipher && (cipher('test') === null)) {
          throw new Error('bad cipher');
        }
        state.isEncrypted = false;
        state.isUnEncrypted = true;
        this._temporal_xpriv = 'something';
      },
      persist,

      isEncrypted: state.isEncrypted,
      isUnEncrypted: state.isUnEncrypted,
      label,
      archived: false,
      extendedPublicKey: xpub,
      extendedPrivateKey: xpriv,
      toJSON () { return {}; }
    };
  };

  let HDAccount = {
    factory: hdAccountFactory,

    fromWalletMasterKey (masterkey, accIndex, label) {
      let node = masterkey.deriveHardened(43).deriveHardened(0).deriveHardened(accIndex);
      let account = hdAccountFactory(node, label);
      return account;
    }
  };

  beforeEach(() => {
    MyWallet = {
      get_history () {},
      syncWallet () {}
    };
    spyOn(MyWallet, 'syncWallet');
    spyOn(MyWallet, 'get_history');
  });

  describe('Constructor', () => {
    beforeEach(() => {
      let KeyRing = () => ({init () {}});
      let KeyChain = {};
      let stubs = { './wallet': MyWallet, './keyring': KeyRing, './keychain': KeyChain };
      HDWallet = proxyquire('../src/hd-wallet', stubs);
    });

    it('should create an empty HDWallet with default options', () => {
      wallet = new HDWallet();
      expect(wallet._accounts.length).toEqual(0);
    });

    it('should transform an Object to an HDAccount', () => {
      let stubs = { './wallet': MyWallet, './hd-account': HDAccount };
      HDWallet = proxyquire('../src/hd-wallet', stubs);
      spyOn(HDAccount, 'factory');
      wallet = new HDWallet(object);

      expect(wallet._seedHex).toEqual(object.seed_hex);
      expect(wallet._bip39Password).toEqual(object.passphrase);
      expect(wallet._mnemonic_verified).toEqual(object.mnemonic_verified);
      expect(wallet._default_account_idx).toEqual(object.default_account_idx);
      expect(HDAccount.factory.calls.count()).toEqual(object.accounts.length);
    });
  });

  describe('instance', () => {
    BIP39 = {
      mnemonicToEntropy (mnemonic) {
        return '0123456789abcdef0123456789abcdef';
      }
    };

    beforeEach(() => {
      let stubs = {
        './wallet': MyWallet,
        'bip39': BIP39,
        'bitcoinjs-lib': Bitcoin,
        './hd-account': HDAccount
      };
      HDWallet = proxyquire('../src/hd-wallet', stubs);
      wallet = new HDWallet(object);
      walletSecondPw = HDWallet.new('mnemonic', 'password');
    });

    describe('Setter', () => {
      let testSet = (prop) => () => { wallet[prop] = 'not allowed'; };

      it('seedHex is read only', () => {
        expect(testSet('seedHex')).toThrow();
      });

      it('bip39Password is read only', () => {
        expect(testSet('bip39Password')).toThrow();
      });

      it('isMnemonicVerified is read only', () => {
        expect(testSet('isMnemonicVerified')).toThrow();
      });

      it('defaultAccount is read only', () => {
        expect(testSet('defaultAccount')).toThrow();
      });

      it('accounts is read only', () => {
        expect(testSet('accounts')).toThrow();
      });

      it('activeAccounts is read only', () => {
        expect(testSet('activeAccounts')).toThrow();
      });

      it('xpubs is read only', () => {
        expect(testSet('xpubs')).toThrow();
      });

      it('activeXpubs is read only', () => {
        expect(testSet('activeXpubs')).toThrow();
      });

      it('balanceActiveAccounts is read only', () => {
        expect(testSet('balanceActiveAccounts')).toThrow();
      });

      it('lastAccount is read only', () => {
        expect(testSet('lastAccount')).toThrow();
      });

      it('defaultAccountIndex should throw exception if is non-number set', () => {
        let wrongSet = () => { wallet.defaultAccountIndex = 'failure'; };
        expect(wrongSet).toThrow();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });

      it('defaultAccountIndex should be set and sync wallet', () => {
        wallet.defaultAccountIndex = 0;
        expect(wallet.defaultAccountIndex).toEqual(0);
        expect(MyWallet.syncWallet).toHaveBeenCalled();
      });
    });

    describe('HDWallet.new()', () => {
      beforeEach(() => {
        let stubs = {
          './wallet': MyWallet
        };

        HDWallet = proxyquire('../src/hd-wallet', stubs);
      });

      it('should return an hdwallet with the correct non-encrypted seedHex', () => {
        let hdw = HDWallet.new('bicycle balcony prefer kid flower pole goose crouch century lady worry flavor', undefined, null);
        expect(hdw._seedHex).toEqual('15e23aa73d25994f1921a1256f93f72c');
      });

      it('should return an hdwallet with a random encrypted seedHex', () => {
        let encoder = msg => `encrypted-${msg}`;
        let hdw = HDWallet.new('bicycle balcony prefer kid flower pole goose crouch century lady worry flavor', undefined, encoder);
        expect(hdw._seedHex).toEqual('encrypted-15e23aa73d25994f1921a1256f93f72c');
      });
    });

    describe('Getter', () => {
      it('seedHex', () => expect(wallet.seedHex).toEqual(object.seed_hex));

      it('bip39Password', () => expect(wallet.bip39Password).toEqual(object.passphrase));

      it('isMnemonicVerified', () => expect(wallet.isMnemonicVerified).toEqual(object.mnemonic_verified));

      it('defaultAccount', () => expect(wallet.defaultAccount).toBeDefined());

      it('accounts', () => expect(wallet.accounts.length).toEqual(object.accounts.length));

      it('activeAccounts', () => expect(wallet.activeAccounts.length).toEqual(1));

      it('xpubs', () => expect(wallet.xpubs[0]).toEqual(object.accounts[0].xpub));

      it('activeXpubs', () => expect(wallet.activeXpubs[0]).toEqual(object.accounts[0].xpub));

      it('balanceActiveAccounts null balance', () => expect(wallet.balanceActiveAccounts).toEqual(null));

      it('balanceActiveAccounts not null balance', () => {
        wallet.accounts[0].balance = 1000;
        expect(wallet.balanceActiveAccounts).toEqual(1000);
      });

      it('lastAccount', () => expect(wallet.lastAccount.extendedPublicKey).toEqual(object.accounts[0].xpub));

      it('defaultAccountIndex', () => expect(wallet.defaultAccountIndex).toEqual(0));

      describe('getMasterHDNode', () => {
        it("should be 'm'", () => {
          spyOn(HDWallet, 'getMasterHex').and.callFake(() => 'm-buffer');
          expect(wallet.getMasterHDNode().toBase58()).toEqual('m');
        });

        it('should throw when the seed hex is bad', () => {
          spyOn(HDWallet, 'getMasterHex').and.callFake(() => 'bad');
          expect(() => wallet.getMasterHDNode()).toThrow();
        });
      });
    });

    describe('Method', () => {
      it('.isValidAccountIndex should be (0 =< index < #accounts - 1)', () => {
        expect(wallet.isValidAccountIndex(-1)).toBeFalsy();
        expect(wallet.isValidAccountIndex(-1.242)).toBeFalsy();
        expect(wallet.isValidAccountIndex(0)).toBeTruthy();
        expect(wallet.isValidAccountIndex(+1)).toBeFalsy();
        expect(wallet.isValidAccountIndex(+1.325453)).toBeFalsy();
        expect(wallet.isValidAccountIndex({'a': 1})).toBeFalsy();
      });

      it('.verifyMnemonic should set to true and sync', () => {
        wallet.verifyMnemonic();
        expect(wallet.isMnemonicVerified).toBeTruthy();
        expect(MyWallet.syncWallet).toHaveBeenCalled();
      });

      it('.account should return an account given the xpub', () => {
        let { xpub } = object.accounts[0];
        expect(wallet.account(xpub).extendedPublicKey).toEqual(xpub);
      });

      it('.account should return null if no xpub', () => {
        let xpub = 'this is not good';
        expect(wallet.account(xpub)).toEqual(null);
      });

      it('.activeAccount should not return an archived account', () => {
        let { xpub } = object.accounts[0];
        wallet.accounts[0].archived = true;
        expect(wallet.activeAccount(xpub)).toEqual(null);
      });

      it('.activeAccount should return an active account', () => {
        let { xpub } = object.accounts[0];
        expect(wallet.activeAccount(xpub).extendedPublicKey).toEqual(xpub);
      });
    });

    describe('JSON serialization', () =>

      it('should hold: fromJSON . toJSON = id', () => {
        let json1 = JSON.stringify(wallet, null, 2);
        let rwall = JSON.parse(json1, HDWallet.reviver);
        let json2 = JSON.stringify(rwall, null, 2);
        expect(json1).toEqual(json2);
      })
    );

    describe('.encrypt', () => {
      it('should fail and not sync when encryption fails', () => {
        let wrongEnc = () => wallet.encrypt(() => null);
        expect(wrongEnc).toThrow();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });

      it('should write in a temporary field and let the original elements intact', () => {
        wallet._bip39Password = 'something';
        let originalSeed = wallet.seedHex;
        let originalpass = wallet.bip39Password;

        wallet.encrypt(() => 'encrypted');

        let areAccountsEncrypted = !wallet.accounts.map((o) => o._temporal_xpriv).some(e => e === undefined);
        expect(wallet._temporal_seedHex).toEqual('encrypted');
        expect(wallet._temporal_bip39Password).toEqual('encrypted');
        expect(wallet.seedHex).toEqual(originalSeed);
        expect(wallet.bip39Password).toEqual(originalpass);
        expect(areAccountsEncrypted).toBeTruthy();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });
    });

      // check the undefined cipher case on the implementation
      // it 'should do nothing if no cipher provided', ->
      //   wallet._bip39Password = "something"
      //   originalSeed = wallet.seedHex
      //   originalpass = wallet.bip39Password

      //   wallet.encrypt(undefined)

      //   areAccountsEncrypted = not wallet.accounts
      //                            .map((a) ->  a._temporal_xpriv)
      //                              .some((e) -> e is undefined)
      //   expect(wallet._temporal_seedHex).toEqual(undefined)
      //   expect(wallet._temporal_bip39Password).toEqual(undefined)
      //   expect(wallet.seedHex).toEqual(originalSeed)
      //   expect(wallet.bip39Password).toEqual(originalpass)
      //   expect(areAccountsEncrypted).toBeFalsy()

    describe('.decrypt', () => {
      it('should fail and don\'t sync when decryption fails', () => {
        let wrongEnc = () => wallet.decrypt(() => null);
        expect(wrongEnc).toThrow();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });

      it('should write in a temporary field and let the original elements intact', () => {
        wallet._bip39Password = 'something';
        let originalSeed = wallet.seedHex;
        let originalpass = wallet.bip39Password;

        wallet.decrypt(() => 'decrypted');

        let areAccountsDecrypted = !wallet.accounts.map((o) => o._temporal_xpriv).some(e => e === undefined);
        expect(wallet._temporal_seedHex).toEqual('decrypted');
        expect(wallet._temporal_bip39Password).toEqual('decrypted');
        expect(wallet.seedHex).toEqual(originalSeed);
        expect(wallet.bip39Password).toEqual(originalpass);
        expect(areAccountsDecrypted).toBeTruthy();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });
    });

      // check the undefined cipher case on the implementation
      // it 'should do nothing if no cipher provided', ->
      //   wallet._bip39Password = "something"
      //   originalSeed = wallet.seedHex
      //   originalpass = wallet.bip39Password

      //   wallet.encrypt(undefined)

      //   areAccountsEncrypted = not wallet.accounts
      //                            .map((a) ->  a._temporal_xpriv)
      //                              .some((e) -> e is undefined)
      //   expect(wallet._temporal_seedHex).toEqual(undefined)
      //   expect(wallet._temporal_bip39Password).toEqual(undefined)
      //   expect(wallet.seedHex).toEqual(originalSeed)
      //   expect(wallet.bip39Password).toEqual(originalpass)
      //   expect(areAccountsEncrypted).toBeFalsy()

    describe('.persist', () => {
      it('should do nothing if temporary is empty', () => {
        let originalSeed = wallet.seedHex;
        let originalpass = wallet.bip39Password;
        wallet.persist();
        expect(wallet.seedHex).toEqual(originalSeed);
        expect(wallet.bip39Password).toEqual(originalpass);
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });

      it('should swap and delete if we have temporary values', () => {
        wallet._temporal_seedHex = 'encrypted seed';
        wallet._temporal_bip39Password = 'encrypted bip39pass';
        let tempSeed = wallet._temporal_seedHex;
        let tempPass = wallet._temporal_bip39Password;
        wallet.persist();
        expect(wallet.seedHex).toEqual(tempSeed);
        expect(wallet.bip39Password).toEqual(tempPass);
        expect(wallet._temporal_seedHex).not.toBeDefined();
        expect(wallet._temporal_bip39Password).not.toBeDefined();
        expect(MyWallet.syncWallet).not.toHaveBeenCalled();
      });
    });

    describe('.factory', () =>
      it('should not touch an existing object', () => {
        let fromFactory = HDWallet.factory(wallet);
        expect(fromFactory).toEqual(wallet);
      })
    );

    describe('.newAccount', () => {
      beforeEach(() => {
        let mockHDNode = {
          toBase58 () { return 'm'; },
          deriveHardened (purpose) {
            return {
              deriveHardened (coinType) {
                return {
                  deriveHardened (account) {
                    let acc = `m/${purpose}'/${coinType}'/${account}'`;
                    return {
                      toBase58 () { return `${acc}-base58`; },
                      neutered () {
                        return {toBase58 () { return `${acc}-neutered-base58`; }};
                      }
                    };
                  }
                };
              }
            };
          }
        };
        spyOn(wallet, 'getMasterHDNode').and.returnValue(mockHDNode);
        spyOn(walletSecondPw, 'getMasterHDNode').and.returnValue(mockHDNode);
      });

      let observer = {
        cipher (mode) {
          if (mode === 'enc') {
            return () => 'aSBhbSBlbmNyeXB0ZWQ=';
          } else if (mode === 'dec') {
            return () => '0123456789abecdf0123456789abecdf';
          } else {
            expect(true).toEqual(false);
          }
        }
      };

      it('should create a new account without a cipher and with an empty passphrase', () => {
        wallet = wallet.newAccount('Savings');

        expect(wallet.accounts.length).toEqual(2);
        expect(wallet.accounts[wallet.accounts.length - 1].label).toEqual('Savings');
      });

      it('should create a new account without a cipher and with a password', () => {
        walletSecondPw = walletSecondPw.newAccount('Savings');

        expect(walletSecondPw.accounts.length).toEqual(1);
        expect(walletSecondPw.accounts[wallet.accounts.length - 1].label).toEqual('Savings');
      });

      it('should create a new account with a cipher and with an empty passphrase', () => {
        wallet = wallet.newAccount('Savings', observer.cipher);
        expect(wallet.accounts.length).toEqual(2);
        expect(wallet.accounts[wallet.accounts.length - 1].label).toEqual('Savings');
      });

      it('should create a new account with a cipher and with a password', () => {
        walletSecondPw = walletSecondPw.newAccount('Savings', observer.cipher);

        expect(walletSecondPw.accounts.length).toEqual(1);
        expect(walletSecondPw.accounts[wallet.accounts.length - 1].label).toEqual('Savings');
      });
    });

    describe('isUnEncrypted and isEncrypted', () => {
      let observer = {
        cipher (mode) {
          if (mode === 'enc') {
            return () => 'aSBhbSBlbmNyeXB0ZWQ=';
          } else if (mode === 'dec') {
            return () => '0123456789abecdf0123456789abecdf';
          } else {
            expect(true).toEqual(false);
          }
        }
      };

      it('should be correct for the non encrypted test HDWallet', () => {
        expect(wallet.isUnEncrypted).toBeTruthy();
        expect(wallet.isEncrypted).toBeFalsy();
      });

      it('should considered an encrypted but non persisted wallet as unencrypted', () => {
        wallet = wallet.encrypt(observer.cipher('enc'));
        expect(wallet.isUnEncrypted).toBeTruthy();
        expect(wallet.isEncrypted).toBeFalsy();
      });

      it('should considered an encrypted and persisted wallet as encrypted', () => {
        wallet = wallet.encrypt(observer.cipher('enc')).persist();
        expect(wallet.isUnEncrypted).toBeFalsy();
        expect(wallet.isEncrypted).toBeTruthy();
      });
    });
  });
});
