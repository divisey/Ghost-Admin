import AuthenticatedRoute from 'ghost-admin/routes/authenticated';
import {inject as service} from '@ember/service';

export default AuthenticatedRoute.extend({
    intl: service(),

    model() {
        return (new Date()).valueOf();
    },

    buildRouteInfoMetadata() {
        return {
            titleToken: this.intl.t('pageTitle.Site')
        };
    }
});
