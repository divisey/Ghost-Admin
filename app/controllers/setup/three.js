/* eslint-disable ghost/ember/alias-model-in-controller */
import Controller, {inject as controller} from '@ember/controller';
import DS from 'ember-data';
import Ember from 'ember';
import RSVP from 'rsvp';
import validator from 'validator';
import {alias} from '@ember/object/computed';
import {computed} from '@ember/object';
import {A as emberA} from '@ember/array';
import {htmlSafe} from '@ember/string';
import {isInvalidError} from 'ember-ajax/errors';
import {run} from '@ember/runloop';
import {inject as service} from '@ember/service';
import {task, timeout} from 'ember-concurrency';

const {Errors} = DS;

export default Controller.extend({
    two: controller('setup/two'),
    notifications: service(),
    intl: service(),

    users: '',

    errors: Errors.create(),
    hasValidated: emberA(),
    ownerEmail: alias('two.email'),

    usersArray: computed('users', function () {
        let errors = this.errors;
        let users = this.users.split('\n').filter(function (email) {
            return email.trim().length > 0;
        });

        // remove "no users to invite" error if we have users
        if (users.uniq().length > 0 && errors.get('users.length') === 1) {
            //TODO: refactor so it shouldn't depend on locale string
            if (errors.get('users.firstObject').message.toString().match(/no users/i)) {
                errors.remove('users');
            }
        }

        return users.uniq();
    }),

    validUsersArray: computed('usersArray', 'ownerEmail', function () {
        let ownerEmail = this.ownerEmail;

        return this.usersArray.filter(function (user) {
            return validator.isEmail(user || '') && user !== ownerEmail;
        });
    }),

    invalidUsersArray: computed('usersArray', 'ownerEmail', function () {
        let ownerEmail = this.ownerEmail;

        return this.usersArray.reject(user => validator.isEmail(user || '') || user === ownerEmail);
    }),

    validationResult: computed('invalidUsersArray', function () {
        let errors = [];

        this.invalidUsersArray.forEach((user) => {
            errors.push({
                user,
                error: 'email'
            });
        });

        if (errors.length === 0) {
            // ensure we aren't highlighting fields when everything is fine
            this.errors.clear();
            return true;
        } else {
            return errors;
        }
    }),

    buttonText: computed('errors.users', 'validUsersArray', 'invalidUsersArray', function () {
        let usersError = this.get('errors.users.firstObject.message');

        let validNum = this.validUsersArray.length;
        let invalidNum = this.invalidUsersArray.length;

        //TODO: (ololoken) refactor so it shouldn't depend on locale string
        if (usersError && usersError.toString().match(/no users/i)) {
            return usersError;
        }

        if (invalidNum > 0) {
            return this.intl.t('{invalid emails, plural}', {'invalid emails': invalidNum});
        }

        return this.intl.t('Invite {users, plural}', {users: validNum});
    }),

    buttonClass: computed('validationResult', 'usersArray.length', function () {
        if (this.validationResult === true && this.get('usersArray.length') > 0) {
            return 'gh-btn-green';
        } else {
            return 'gh-btn-minor';
        }
    }),

    authorRole: computed(function () {
        return this.store.findAll('role', {reload: true}).then(roles => roles.findBy('name', 'Author'));
    }),

    actions: {
        validate() {
            this.validate();
        },

        invite() {
            this.invite.perform();
        },

        skipInvite() {
            this.send('loadServerNotifications');
            this.transitionToRoute('home');
        }
    },

    validate() {
        let errors = this.errors;
        let validationResult = this.validationResult;
        let property = 'users';

        errors.clear();

        // If property isn't in the `hasValidated` array, add it to mark that this field can show a validation result
        this.hasValidated.addObject(property);

        if (validationResult === true) {
            return true;
        }

        validationResult.forEach((error) => {
            // Only one error type here so far, but one day the errors might be more detailed
            switch (error.error) {
            case 'email':
                errors.add(property, this.intl.t('validation.{email} is not a valid email.', {email: error.user}));
            }
        });

        return false;
    },

    _transitionAfterSubmission() {
        if (!this._hasTransitioned) {
            this._hasTransitioned = true;
            this.transitionToRoute('home');
        }
    },

    invite: task(function* () {
        let users = this.validUsersArray;

        if (this.validate() && users.length > 0) {
            this._hasTransitioned = false;

            this._slowSubmissionTimeout.perform();

            let authorRole = yield this.authorRole;
            let invites = yield this._saveInvites(authorRole);

            this._slowSubmissionTimeout.cancelAll();

            this._showNotifications(invites);

            run.schedule('actions', this, function () {
                this.send('loadServerNotifications');
                this._transitionAfterSubmission();
            });
        } else if (users.length === 0) {
            this.errors.add('users', this.intl.t('validation.No users to invite'));
        }
    }).drop(),

    _slowSubmissionTimeout: task(function* () {
        yield timeout(4000);
        this._transitionAfterSubmission();
    }).drop(),

    _saveInvites(authorRole) {
        let users = this.validUsersArray;

        return RSVP.Promise.all(
            users.map((user) => {
                let invite = this.store.createRecord('invite', {
                    email: user,
                    role: authorRole
                });

                return invite.save().then(() => ({
                    email: user,
                    success: invite.get('status') === 'sent'
                })).catch(error => ({
                    error,
                    email: user,
                    success: false
                }));
            })
        );
    },

    _showNotifications(invites) {
        let notifications = this.notifications;
        let erroredEmails = [];
        let successCount = 0;
        let message;

        invites.forEach((invite) => {
            if (invite.success) {
                successCount += 1;
            } else if (isInvalidError(invite.error)) {
                message = this.intl.t('validation.{email} was invalid: {message}', {email: invite.email, message: invite.error.payload.errors[0].message});
                notifications.showAlert(message, {type: 'error', delayed: true, key: `signup.send-invitations.${invite.email}`});
            } else {
                erroredEmails.push(invite.email);
            }
        });

        if (erroredEmails.length > 0) {
            message = this.intl.t('Failed to send {invitations, plural} {erroredEmails}. Please check your email configuration, see <a href="{link}" target="_blank">{link}</a> for instructions', {
                invitations: erroredEmails.length,
                erroredEmails: Ember.Handlebars.Utils.escapeExpression(erroredEmails.join(', ')),
                link: 'https://ghost.org/docs/concepts/config/#mail'
            });

            message = htmlSafe(message);
            notifications.showAlert(message, {type: 'error', delayed: successCount > 0, key: 'signup.send-invitations.failed'});
        }

        if (successCount > 0) {
            notifications.showAlert(this.intl.t('{invitations, plural} sent!', {invitations: successCount}), {type: 'success', delayed: true, key: 'signup.send-invitations.success'});
        }
    }
});
