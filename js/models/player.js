export class Player {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.nationality = data.nationality;
        this.position = data.position;
        this.dateOfBirth = data.dateOfBirth;
        this.teams = data.teams || [];
        this.stats = data.stats || {};
    }

    get age() {
        if (!this.dateOfBirth) return null;
        const birthDate = new Date(this.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }

    isJourneyman() {
        // ponytail: simplistic definition, update if data contains specific loan/transfer counts
        return this.teams.length >= 5;
    }

    get currentTeam() {
        return this.teams.length > 0 ? this.teams[this.teams.length - 1].name : 'Unknown';
    }

    matches(category, value) {
        if (category === 'Nationality') return this.nationality === value;
        if (category === 'Position') return this.position === value;
        if (category === 'League') {
            return this.teams && this.teams.some(t => t.league === value);
        }
        if (category === 'Team') {
            return this.teams && this.teams.some(t => t.team === value);
        }
        if (category === 'Trait') {
            if (value === 'Journeyman (2+ Leagues)') return this.isJourneyman();
            if (value === 'Veteran (Age 28+)') return this.age >= 28;
            if (value === 'Young Prospect (Age < 24)') return this.age < 24;
            if (value === 'Multi-Club Veteran') {
                const teams = new Set((this.teams || []).map(t => t.team));
                return teams.size >= 2;
            }
        }
        return false;
    }
}
