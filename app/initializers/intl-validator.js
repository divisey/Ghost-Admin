import BaseValidator from 'ghost-admin/validators/base';
export function initialize(application) {
    //dirty hack to "inject" intl into objects without containers
    BaseValidator.reopen({intl: application.__container__.lookup('service:intl')});
}

export default {
    name: 'intl-validator',
    initialize
};